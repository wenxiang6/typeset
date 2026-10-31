"""裸域名门禁：体验令牌 + 弱密码，全部服务器签名/校验（防控制台篡改）。

- 令牌 = {exp}.{typ}.{ver}.{sig}，HMAC-SHA256(admin_secret) 签名，typ ∈ trial/full
  trial：过期时间在令牌里，每次请求服务器重验；前端倒计时只是显示，改本地变量没用
  full：带密码版本号 ver，后台改密码即作废旧的全部 full 令牌
- 密码/时长存 gate_settings 表（admin 后台可改，即时生效），env 只做首次默认值
- 访问控制：个人凭证（?u=&k=）优先走原路；匿名（无凭证）调 compute 端点必须带有效令牌
- 弱密码登录限速：同 IP 连错 5 次锁 10 分钟（与 admin 登录同一套参数，独立计数）
"""

import hashlib
import hmac
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .audit import client_ip, log_event
from .auth import get_session
from .config import settings
from .models import GateSetting

router = APIRouter()

FULL_TTL_S = 365 * 24 * 3600  # full 令牌一年；改密码即批量作废，不需要更久

# 登录限速（防爆破）：同 IP 连错 5 次，锁 10 分钟。内存态，重启即清。
_FAILS: dict[str, tuple[int, float]] = {}
FAIL_LIMIT = 5
LOCK_SECONDS = 600


# ---------------- 令牌 ----------------


def _sign(payload: str) -> str:
    return hmac.new(settings.admin_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _make_token(typ: str, ttl_s: int, ver: int) -> str:
    exp = int(time.time()) + ttl_s
    payload = f"{exp}.{typ}.{ver}"
    return f"{payload}.{_sign(payload)}"


def _verify_token(token: str, cur_ver: int) -> tuple[str, int] | None:
    """校验通过返回 (typ, exp)；无效/过期/版本不符返回 None。"""
    try:
        exp_s, typ, ver_s, sig = token.split(".", 3)
        exp, ver = int(exp_s), int(ver_s)
    except Exception:
        return None
    if not hmac.compare_digest(sig, _sign(f"{exp_s}.{typ}.{ver_s}")):
        return None
    if typ == "trial":
        return ("trial", exp) if exp > time.time() else None
    if typ == "full":
        return ("full", exp) if ver == cur_ver else None
    return None


def token_from(request: Request) -> str:
    return request.headers.get("x-gate-token") or request.query_params.get("t") or ""


# ---------------- 配置读写（gate_settings 表，缺行回退 env 默认值） ----------------


async def _get_setting(s: AsyncSession, key: str, default: str) -> str:
    row = (await s.execute(select(GateSetting).where(GateSetting.key == key))).scalar_one_or_none()
    return row.value if row else default


async def _set_setting(s: AsyncSession, key: str, value: str) -> None:
    row = (await s.execute(select(GateSetting).where(GateSetting.key == key))).scalar_one_or_none()
    if row:
        row.value = value
        row.updated_at = int(time.time() * 1000)
    else:
        s.add(GateSetting(key=key, value=value, updated_at=int(time.time() * 1000)))


async def gate_password(s: AsyncSession) -> str:
    return await _get_setting(s, "password", settings.gate_password)


async def trial_minutes(s: AsyncSession) -> int:
    try:
        return int(await _get_setting(s, "trial_minutes", str(settings.trial_minutes)))
    except ValueError:
        return settings.trial_minutes


async def pw_version(s: AsyncSession) -> int:
    try:
        return int(await _get_setting(s, "pw_version", "0"))
    except ValueError:
        return 0


# ---------------- 登录限速 ----------------


def _gate_ip(request: Request) -> str:
    return client_ip(request)


def _blocked(request: Request) -> int:
    ip = _gate_ip(request)
    entry = _FAILS.get(ip)
    if not entry:
        return 0
    fails, until = entry
    if until and until > time.time():
        return int(until - time.time())
    if until and until <= time.time():
        _FAILS.pop(ip, None)
    return 0


def _fail(request: Request) -> None:
    ip = _gate_ip(request)
    fails, until = _FAILS.get(ip, (0, 0.0))
    fails += 1
    _FAILS[ip] = (fails, time.time() + LOCK_SECONDS if fails >= FAIL_LIMIT else 0.0)


def _clear(request: Request) -> None:
    _FAILS.pop(_gate_ip(request), None)


# ---------------- 端点 ----------------


class GateLoginBody(BaseModel):
    password: str


@router.post("/api/gate/trial")
async def gate_trial(request: Request, s: AsyncSession = Depends(get_session)) -> dict:
    """签发体验令牌：无门槛，时长按后台配置（默认 10 分钟）。"""
    minutes = await trial_minutes(s)
    token = _make_token("trial", minutes * 60, 0)
    await log_event("gate_trial_start", ip=client_ip(request), detail={"minutes": minutes})
    return {
        "ok": True,
        "token": token,
        "mode": "trial",
        "seconds": minutes * 60,
        "expiresAt": (int(time.time()) + minutes * 60) * 1000,
    }


@router.post("/api/gate/login")
async def gate_login(request: Request, body: GateLoginBody, s: AsyncSession = Depends(get_session)) -> dict:
    ip = client_ip(request)
    locked = _blocked(request)
    if locked:
        return {"ok": False, "error": f"失败次数过多，锁定中，约 {locked // 60 + 1} 分钟后可再试"}
    pwd = await gate_password(s)
    if not body.password or not hmac.compare_digest(body.password, pwd):
        _fail(request)
        await log_event("gate_login_fail", ip=ip, ok=False, detail={"reason": "访问密码不正确"})
        return {"ok": False, "error": "访问密码不对"}
    _clear(request)
    ver = await pw_version(s)
    token = _make_token("full", FULL_TTL_S, ver)
    await log_event("gate_login_ok", ip=ip)
    return {
        "ok": True,
        "token": token,
        "mode": "full",
        "expiresAt": (int(time.time()) + FULL_TTL_S) * 1000,
    }


@router.get("/api/gate/remaining")
async def gate_remaining(request: Request, s: AsyncSession = Depends(get_session)) -> dict:
    """倒计时校准：剩余秒数以服务器时间为准。full 模式返回 -1（无限制）。"""
    token = token_from(request)
    if not token:
        raise HTTPException(status_code=401, detail="missing gate token")
    mode = _verify_token(token, await pw_version(s))
    if not mode:
        raise HTTPException(status_code=403, detail="gate token invalid or expired")
    typ, exp = mode
    return {"ok": True, "mode": typ, "remaining": -1 if typ == "full" else max(0, exp - int(time.time()))}


# ---------------- compute 端点的访问控制 ----------------


async def gate_access(request: Request, s: AsyncSession = Depends(get_session)):
    """compute 类端点的鉴权：返回 User（个人凭证）或 None（有效门禁令牌的匿名访问）。

    - 带了 ?u=&k= 但不对 → 401（不降级到令牌，避免拿令牌绕过凭证校验）
    - 无凭证 → 必须带有效门禁令牌，否则 401；令牌过期/伪造 → 403
    """
    u = request.query_params.get("u") or ""
    k = request.query_params.get("k") or ""
    if u and k:
        from .auth import lookup_user

        row = await lookup_user(u, k, s)
        if row is None:
            raise HTTPException(status_code=401, detail="unauthorized")
        return row
    token = token_from(request)
    if not token:
        raise HTTPException(status_code=401, detail="gate token required")
    if not _verify_token(token, await pw_version(s)):
        raise HTTPException(status_code=403, detail="gate token invalid or expired")
    return None
