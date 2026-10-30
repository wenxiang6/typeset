"""向 Node 计算服务转发（/api/elements、/api/layout/validate、/api/format*）。"""

import httpx

from .config import settings

# 计算服务最大耗时（排版可能要几秒）
TIMEOUT = httpx.Timeout(120.0)


async def forward(
    method: str,
    path: str,
    *,
    query: dict[str, str] | None = None,
    content: bytes | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, dict]:
    """转发到计算服务，返回 (status, json)。连接失败统一 502。"""
    url = f"{settings.compute_url.rstrip('/')}{path}"
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.request(method, url, params=query, content=content, headers=headers)
        try:
            data = resp.json()
        except Exception:
            data = {"error": resp.text[:500]}
        return resp.status_code, data
    except httpx.HTTPError as err:
        return 502, {"ok": False, "error": f"计算服务不可用: {err}"}
