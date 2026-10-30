"""管理后台：/admin 单页（服务端渲染，零前端依赖）。

- 权限：ADMIN_SECRET 环境变量；登录后发 HttpOnly HMAC cookie（7 天）
- 功能：用户列表 / 新增（自动生成 secret，凭证只展示一次）/ 删除 / 重置 secret
- 不做：日志审计、角色权限、后台改稿（单人后台，明确拒绝过度设计）
"""

import hashlib
import hmac
import html
import json
import os
import secrets
import time

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from sqlalchemy import func, select

from .auth import credential_for, get_session, viewer_url
from .config import settings
from .db import SessionLocal
from .models import Doc, Snapshot, TemplateList, User

router = APIRouter()

COOKIE = "paiban_admin"
TTL = 7 * 24 * 3600

_STYLE = """
<style>
body{font:14px/1.6 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#111}
table{border-collapse:collapse;width:100%;margin:16px 0}
th,td{border:1px solid #ddd;padding:6px 10px;text-align:left;font-size:13px}
th{background:#f5f5f5}
form{display:inline-block;margin:0}
input,button{font:13px system-ui;padding:4px 8px}
button{cursor:pointer}
.cred{background:#f0f7ff;border:1px solid #bcd; padding:12px;border-radius:8px;margin:12px 0}
.warn{color:#a33}
code{background:#f4f4f4;padding:1px 5px;border-radius:4px}
</style>
"""


def _sign(payload: str) -> str:
    return hmac.new(settings.admin_secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _admin_ok(request: Request) -> bool:
    if not settings.admin_secret:
        return False
    raw = request.cookies.get(COOKIE) or ""
    try:
        exp_s, sig = raw.split(".", 1)
        exp = int(exp_s)
    except Exception:
        return False
    if exp < time.time():
        return False
    return hmac.compare_digest(sig, _sign(exp_s))


def _page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(
        f"<!doctype html><html lang=zh><head><meta charset=utf-8><title>{title}</title>{_STYLE}</head><body>{body}</body></html>"
    )


# ---------------- JSON API（React 后台管理页用，与 HTML 页共用 cookie 会话） ----------------

from fastapi.responses import JSONResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402


class LoginBody(BaseModel):
    password: str


# 登录限速（防 ADMIN_SECRET 被爆破）：同 IP 连错 5 次，锁 10 分钟。内存态，重启即清。
_FAILS: dict[str, tuple[int, float]] = {}
FAIL_LIMIT = 5
LOCK_SECONDS = 600


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _login_blocked(request: Request) -> int:
    """返回剩余锁定秒数，0 = 未锁。"""
    ip = _client_ip(request)
    entry = _FAILS.get(ip)
    if not entry:
        return 0
    fails, blocked_until = entry
    if blocked_until and blocked_until > time.time():
        return int(blocked_until - time.time())
    if blocked_until and blocked_until <= time.time():
        _FAILS.pop(ip, None)
    return 0


def _login_fail(request: Request) -> None:
    ip = _client_ip(request)
    fails, blocked_until = _FAILS.get(ip, (0, 0.0))
    fails += 1
    _FAILS[ip] = (fails, time.time() + LOCK_SECONDS if fails >= FAIL_LIMIT else 0.0)


def _login_ok_clear(request: Request) -> None:
    _FAILS.pop(_client_ip(request), None)


def _check_password(request: Request, password: str) -> bool:
    """统一校验入口：先看是否被锁，再比密码，成败各自记账。"""
    if _login_blocked(request):
        return False
    if settings.admin_secret and hmac.compare_digest(password, settings.admin_secret):
        _login_ok_clear(request)
        return True
    _login_fail(request)
    return False


class UserBody(BaseModel):
    name: str


def _json_err(status: int, msg: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"ok": False, "error": msg})


@router.get("/api/admin/session")
async def admin_session(request: Request):
    """React 后台探登录态。"""
    if _admin_ok(request):
        return {"ok": True}
    return _json_err(401, "未登录")


@router.post("/api/admin/login")
async def admin_login_json(request: Request, body: LoginBody):
    locked = _login_blocked(request)
    if locked:
        return _json_err(429, f"失败次数过多，锁定中，约 {locked // 60 + 1} 分钟后可再试")
    if not _check_password(request, body.password):
        return _json_err(401, "密钥不对")
    exp = int(time.time()) + TTL
    resp = JSONResponse({"ok": True})
    resp.set_cookie(COOKIE, f"{exp}.{_sign(str(exp))}", max_age=TTL, httponly=True, samesite="lax")
    return resp


@router.post("/api/admin/logout")
async def admin_logout_json():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE)
    return resp


async def _list_users() -> list[dict]:
    async with SessionLocal() as s:
        users = (await s.execute(select(User).order_by(User.id))).scalars().all()
        doc_map = {d.user_id: d for d in (await s.execute(select(Doc))).scalars().all()}
        snap_counts = dict(
            (await s.execute(
                select(Snapshot.user_id, func.count(Snapshot.id)).group_by(Snapshot.user_id)
            )).all()
        )
    out = []
    for u in users:
        d = doc_map.get(u.id)
        out.append({
            "name": u.name,
            "createdAt": u.created_at or 0,
            "lastActive": d.at if d else 0,
            "docBytes": len(d.raw) if d else 0,
            "snapshots": snap_counts.get(u.id, 0),
        })
    return out


@router.get("/api/admin/users")
async def admin_users_json(request: Request):
    if not _admin_ok(request):
        return _json_err(401, "未登录")
    return {"ok": True, "users": await _list_users()}


# ---------------- 稿件与模板树 ----------------


def _tpl_meta(item) -> dict:
    """从模板条目里尽量提取名字/时间，字段不确定就防御式取。"""
    if not isinstance(item, dict):
        item = {"id": str(item)}
    tid = str(item.get("id") or item.get("key") or "")
    name = str(item.get("name") or item.get("title") or tid or "未命名模板")
    at = 0
    for key in ("at", "savedAt", "saved_at", "updatedAt", "time"):
        v = item.get(key)
        if isinstance(v, (int, float)) and v > 10**12:  # 毫秒时间戳
            at = int(v)
            break
    raw = json.dumps(item, ensure_ascii=False)
    return {"id": tid or name, "name": name, "at": at, "bytes": len(raw.encode("utf-8"))}


@router.get("/api/admin/tree")
async def admin_tree(request: Request):
    """用户 → 最后一次保存的主稿 + 各模板（含字节数），喂前端的 antd Tree。"""
    if not _admin_ok(request):
        return _json_err(401, "未登录")
    out = []
    async with SessionLocal() as s:
        users = (await s.execute(select(User).order_by(User.id))).scalars().all()
        doc_map = {d.user_id: d for d in (await s.execute(select(Doc))).scalars().all()}
        tpl_rows = {t.user_id: t for t in (await s.execute(select(TemplateList))).scalars().all()}
    for u in users:
        d = doc_map.get(u.id)
        doc = None
        if d:
            pages = 0
            try:
                pages = len(json.loads(d.raw).get("pages", []))
            except Exception:
                pass
            doc = {"at": d.at, "bytes": len(d.raw.encode("utf-8")), "pages": pages}
        tpls: list[dict] = []
        trow = tpl_rows.get(u.id)
        if trow:
            try:
                items = json.loads(trow.list_json)
                if isinstance(items, list):
                    tpls = sorted((_tpl_meta(i) for i in items), key=lambda x: -x["at"])
            except Exception:
                pass
        out.append({"name": u.name, "doc": doc, "templates": tpls})
    return {"ok": True, "tree": out}


@router.get("/api/admin/json")
async def admin_get_json(request: Request, user: str, target: str, download: int = 0):
    """取原文：target=doc → 主稿；target=tpl:<id> → 那份模板的 JSON。download=1 走附件下载。"""
    if not _admin_ok(request):
        return _json_err(401, "未登录")
    async with SessionLocal() as s:
        urow = (await s.execute(select(User).where(User.name == user))).scalar_one_or_none()
        if not urow:
            return _json_err(404, "用户不存在")
        if target == "doc":
            d = await s.get(Doc, urow.id)
            raw = d.raw if d else None
            fname = f"{user}-主稿-{time.strftime('%Y%m%d-%H%M')}.json"
        elif target.startswith("tpl:"):
            tid = target[4:]
            trow = await s.get(TemplateList, urow.id)
            items = json.loads(trow.list_json) if trow else []
            item = next((i for i in items if isinstance(i, dict) and str(i.get("id")) == tid), None)
            if item is None:
                return _json_err(404, "模板不存在")
            raw = json.dumps(item, ensure_ascii=False, indent=2)
            fname = f"{user}-模板-{item.get('name', tid)}.json"
        else:
            return _json_err(400, "target 必须是 doc 或 tpl:<id>")
    if raw is None:
        return _json_err(404, "该用户还没有保存过稿件")
    if download:
        from urllib.parse import quote

        return Response(
            content=raw,
            media_type="application/json; charset=utf-8",
            headers={
                # 中文文件名走 RFC 5987 filename*，ASCII 兜底给老客户端
                "Content-Disposition": f"attachment; filename=\"download.json\"; filename*=UTF-8''{quote(fname)}"
            },
        )
    return Response(raw, media_type="application/json; charset=utf-8")


@router.post("/api/admin/users")
async def admin_add_user_json(request: Request, body: UserBody):
    if not _admin_ok(request):
        return _json_err(401, "未登录")
    name = body.name.strip()
    if not name:
        return _json_err(400, "名字不能为空")
    secret = secrets.token_hex(16)
    async with SessionLocal() as s:
        if (await s.execute(select(User).where(User.name == name))).scalar_one_or_none():
            return _json_err(409, f"名字「{name}」已存在")
        s.add(User(name=name, secret=secret, created_at=int(time.time() * 1000)))
        await s.commit()
    k, _ = credential_for(name, secret)
    return {
        "ok": True,
        "name": name,
        "secret": secret,
        "viewerUrl": viewer_url(settings.base_url, name, secret),
        "note": "secret 只返回这一次，同时记得抄进本地 skill 的 config.json",
    }


@router.delete("/api/admin/users/{name}")
async def admin_delete_user_json(request: Request, name: str):
    if not _admin_ok(request):
        return _json_err(401, "未登录")
    async with SessionLocal() as s:
        row = (await s.execute(select(User).where(User.name == name))).scalar_one_or_none()
        if not row:
            return _json_err(404, "用户不存在")
        await s.delete(row)  # CASCADE 清掉 docs/snapshots/templates
        await s.commit()
    return {"ok": True}


@router.post("/api/admin/users/{name}/reset")
async def admin_reset_user_json(request: Request, name: str):
    if not _admin_ok(request):
        return _json_err(401, "未登录")
    secret = secrets.token_hex(16)
    async with SessionLocal() as s:
        row = (await s.execute(select(User).where(User.name == name))).scalar_one_or_none()
        if not row:
            return _json_err(404, "用户不存在")
        row.secret = secret
        await s.commit()
    k, _ = credential_for(name, secret)
    return {
        "ok": True,
        "name": name,
        "secret": secret,
        "viewerUrl": viewer_url(settings.base_url, name, secret),
        "note": "旧链接已全部失效；secret 只返回这一次",
    }


@router.get("/admin")
async def admin_home(request: Request):
    if not _admin_ok(request):
        return _page(
            "排版管理 · 登录",
            "<h2>排版管理后台</h2><p>请输入管理员密钥（ADMIN_SECRET）。</p>"
            '<form method=post action=/admin/login><input type=password name=password autofocus> '
            '<button>登录</button></form>',
        )

    async with SessionLocal() as s:
        users = (await s.execute(select(User).order_by(User.id))).scalars().all()
        doc_map = {d.user_id: d for d in (await s.execute(select(Doc))).scalars().all()}
        snap_counts = dict(
            (await s.execute(
                select(Snapshot.user_id, func.count(Snapshot.id)).group_by(Snapshot.user_id)
            )).all()
        )

    rows = []
    for u in users:
        d = doc_map.get(u.id)
        active = time.strftime("%m-%d %H:%M", time.localtime(d.at / 1000)) if d and d.at else "—"
        size = f"{len(d.raw) / 1024:.0f} KB" if d else "—"
        rows.append(
            f"<tr><td>{html.escape(u.name)}</td><td>{active}</td>"
            f"<td>{size}</td><td>{snap_counts.get(u.id, 0)}</td>"
            f"<td>{time.strftime('%Y-%m-%d', time.localtime((u.created_at or 0) / 1000)) if u.created_at else '—'}</td>"
            f"<td><form method=post action=/admin/users/reset onsubmit=\"return confirm('重置 {html.escape(u.name)} 的密钥？')\">"
            f'<input type=hidden name=name value="{html.escape(u.name)}"><button>重置密钥</button></form> '
            f"<form method=post action=/admin/users/delete onsubmit=\"return confirm('删除 {html.escape(u.name)} 及其全部稿件？不可恢复！')\">"
            f'<input type=hidden name=name value="{html.escape(u.name)}"><button class=warn>删除</button></form></td></tr>'
        )

    body = (
        "<h2>用户管理</h2>"
        "<table><tr><th>名字</th><th>最后活跃</th><th>稿件大小</th><th>快照数</th><th>创建时间</th><th>操作</th></tr>"
        + ("".join(rows) or '<tr><td colspan=6>还没有用户，先新增一个</td></tr>')
        + "</table>"
        '<h3>新增用户</h3><form method=post action=/admin/users/add>'
        '名字：<input name=name required> <button>创建（secret 自动生成）</button></form>'
        '<p style="margin-top:24px"><form method=post action=/admin/logout><button>退出登录</button></form></p>'
    )
    return _page("排版管理", body)


@router.post("/admin/login")
async def admin_login(request: Request):
    form = await request.form()
    password = str(form.get("password") or "")
    locked = _login_blocked(request)
    if locked:
        return _page("尝试过多", f"<h2>失败次数过多</h2><p>约 {locked // 60 + 1} 分钟后再试。<a href=/admin>返回</a></p>")
    if not _check_password(request, password):
        return _page("登录失败", '<h2>密钥不对</h2><p><a href=/admin>返回重试</a></p>')
    exp = int(time.time()) + TTL
    resp = RedirectResponse("/admin", status_code=303)
    resp.set_cookie(COOKIE, f"{exp}.{_sign(str(exp))}", max_age=TTL, httponly=True, samesite="lax")
    return resp


@router.post("/admin/logout")
async def admin_logout():
    resp = RedirectResponse("/admin", status_code=303)
    resp.delete_cookie(COOKIE)
    return resp


async def _require_admin(request: Request) -> None:
    if not _admin_ok(request):
        raise PermissionError


def _cred_block(name: str, secret: str) -> str:
    k, q = credential_for(name, secret)
    url = f"{settings.base_url.rstrip('/')}/?{q}"
    return (
        f'<div class=cred><b>凭证（只展示这一次，关掉就没）</b><br>'
        f'名字：<code>{html.escape(name)}</code><br>secret：<code>{secret}</code><br>'
        f'访问链接（发给本人）：<br><code>{html.escape(url)}</code></div>'
    )


@router.post("/admin/users/add")
async def admin_add_user(request: Request):
    try:
        await _require_admin(request)
    except PermissionError:
        return _page("未登录", '<p>请先<a href=/admin>登录</a>。</p>')
    form = await request.form()
    name = str(form.get("name") or "").strip()
    if not name:
        return _page("出错", "<p>名字不能为空。<a href=/admin>返回</a></p>")
    secret = secrets.token_hex(16)
    async with SessionLocal() as s:
        exists = (
            await s.execute(select(User).where(User.name == name))
        ).scalar_one_or_none()
        if exists:
            return _page("出错", f"<p>名字 <b>{html.escape(name)}</b> 已存在。<a href=/admin>返回</a></p>")
        s.add(User(name=name, secret=secret, created_at=int(time.time() * 1000)))
        await s.commit()
    _, q = credential_for(name, secret)
    return _page(
        "用户已创建",
        f"<h2>已创建用户：{html.escape(name)}</h2>"
        + _cred_block(name, secret)
        + "<p>同时把 name/secret 抄进本地 skill 的 config.json（users 数组），推送才能选到这个人。</p>"
        '<p><a href=/admin>返回列表</a></p>',
    )


@router.post("/admin/users/delete")
async def admin_delete_user(request: Request):
    try:
        await _require_admin(request)
    except PermissionError:
        return _page("未登录", '<p>请先<a href=/admin>登录</a>。</p>')
    form = await request.form()
    name = str(form.get("name") or "")
    async with SessionLocal() as s:
        row = (await s.execute(select(User).where(User.name == name))).scalar_one_or_none()
        if row:
            await s.delete(row)  # CASCADE 清掉 docs/snapshots/templates
            await s.commit()
    return RedirectResponse("/admin", status_code=303)


@router.post("/admin/users/reset")
async def admin_reset_user(request: Request):
    try:
        await _require_admin(request)
    except PermissionError:
        return _page("未登录", '<p>请先<a href=/admin>登录</a>。</p>')
    form = await request.form()
    name = str(form.get("name") or "")
    secret = secrets.token_hex(16)
    async with SessionLocal() as s:
        row = (await s.execute(select(User).where(User.name == name))).scalar_one_or_none()
        if not row:
            return _page("出错", "<p>用户不存在。<a href=/admin>返回</a></p>")
        row.secret = secret
        await s.commit()
    return _page(
        "密钥已重置",
        f"<h2>已重置：{html.escape(name)}</h2>" + _cred_block(name, secret)
        + "<p style=class=warn>旧链接全部失效。记得同步更新 config.json。</p><p><a href=/admin>返回列表</a></p>",
    )
