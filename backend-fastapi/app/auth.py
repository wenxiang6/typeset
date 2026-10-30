"""凭证鉴权：md5(name + ':' + secret)，与 skill（paiban-word-to-json）约定一致。

约定（别改拼法）：
- 客户端带 ?u=<name>&k=<md5>
- 服务端按 name 查 secret 原文，重算 md5 比对（不存 md5 结果，换密钥只改 secret）
- 不匹配一律 401，错误信息不回显细节
"""

import hashlib

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .db import SessionLocal
from .models import User


def md5_hex(s: str) -> str:
    return hashlib.md5(s.encode("utf-8")).hexdigest()


def credential_for(name: str, secret: str) -> tuple[str, str]:
    """返回 (k, viewerUrl 里的 query 片段)。供 admin 页与迁移脚本复用。"""
    k = md5_hex(f"{name}:{secret}")
    return k, f"u={name}&k={k}"


def viewer_url(base_url: str, name: str, secret: str) -> str:
    """分享链接落点：/view 只读预览。本人编辑直接开站点根路径（凭证在本地会记住）。"""
    _, q = credential_for(name, secret)
    return f"{base_url.rstrip('/')}/view?{q}"


async def get_session() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


async def current_user(request: Request, session: AsyncSession = Depends(get_session)) -> User:
    u = request.query_params.get("u") or ""
    k = request.query_params.get("k") or ""
    if not u or not k:
        raise HTTPException(status_code=401, detail="unauthorized")
    row = (await session.execute(select(User).where(User.name == u))).scalar_one_or_none()
    if row is None or md5_hex(f"{row.name}:{row.secret}") != k:
        raise HTTPException(status_code=401, detail="unauthorized")
    return row
