"""审计日志：结构化事件写 PG，保留 30 天，失败绝不影响主流程。

设计原则：
- 每条事件一行（audit_log 表），self-contained 短会话写入；
- 任何异常都吞掉——日志永远不能拖垮业务主流程；
- 保留 30 天，约 2% 的写入顺带触发一次过期清理（分摊压力，不靠定时任务）。
"""

import json
import random
import time

from fastapi import Request
from sqlalchemy import delete

from .db import SessionLocal
from .models import AuditLog

RETENTION_MS = 30 * 24 * 3600 * 1000
_CLEAN_PROB = 0.02


def client_ip(request: Request) -> str:
    """真实客户端 IP。Caddy 反代会带 X-Forwarded-For，取第一个（最原始的）。"""
    xf = request.headers.get("x-forwarded-for")
    if xf:
        return xf.split(",")[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


async def log_event(
    event: str, *, user: str = "", ip: str = "", ok: bool = True, detail: dict | None = None
) -> None:
    try:
        now = int(time.time() * 1000)
        async with SessionLocal() as s:
            s.add(
                AuditLog(
                    at=now,
                    event=event,
                    user=user,
                    ip=ip,
                    ok=ok,
                    detail=json.dumps(detail or {}, ensure_ascii=False),
                )
            )
            await s.commit()
            if random.random() < _CLEAN_PROB:
                await s.execute(delete(AuditLog).where(AuditLog.at < now - RETENTION_MS))
                await s.commit()
    except Exception:
        pass
