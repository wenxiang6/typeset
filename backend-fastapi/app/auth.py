"""凭证鉴权：md5(name + ':' + secret)，与 skill（paiban-word-to-json）约定一致。

约定（别改拼法）：
- 客户端带 ?u=<name>&k=<md5>
- 服务端按 name 查 secret 原文，重算 md5 比对（不存 md5 结果，换密钥只改 secret）
- 不匹配一律 401，错误信息不回显细节
"""

import hashlib
from urllib.parse import quote

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .models import User


def md5_hex(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def credential_for(name: str, secret: str) -> tuple[str, str]:
    """返回 (k, viewerUrl 里的 query 片段)。name 走百分号编码——链接里不出现
    中文/空格，聊天里裸贴、复制到浏览器都不会断。供 admin 页与迁移脚本复用。"""
    k = md5_hex(f"{name}:{secret}")
    return k, f"u={quote(name, safe='')}&k={k}"


def viewer_url(base_url: str, name: str, secret: str) -> str:
    """推送链接落点：编辑器（打开即可查看并微调，外部推送会自动载入并给旧稿打快照）。
    纯只读预览是 /view?u=&k=，需要时手动把 / 换成 /view。"""
    _, q = credential_for(name, secret)
    return f"{base_url.rstrip('/')}/?{q}"


async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


async def lookup_user(u: str, k: str, session: AsyncSession) -> User | None:
    """按 name 查 secret 原文重算 md5 比对。不匹配返回 None，不抛异常。"""
    if not u or not k:
        return None
    row = (await session.execute(select(User).where(User.name == u))).scalar_one_or_none()
    if row is None or md5_hex(f"{row.name}:{row.secret}") != k:
        return None
    return row


async def current_user(request: Request, session: AsyncSession = Depends(get_session)) -> User:
    u = request.query_params.get("u") or ""
    k = request.query_params.get("k") or ""
    row = await lookup_user(u, k, session)
    if row is None:
        # 只记「带了凭证但被拒」的：裸匿名的 401 是常态（门禁页/单机模式），记了全是噪音
        if u or k:
            from .audit import client_ip, log_event

            await log_event(
                "cred_401",
                user=u,
                ip=client_ip(request),
                ok=False,
                detail={"path": request.url.path},
            )
        raise HTTPException(status_code=401, detail="unauthorized")
    return row
