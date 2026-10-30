"""FastAPI 网关主入口：鉴权 + PostgreSQL 存储 + 计算服务转发 + 静态托管 + /admin。

对前端 / skill 的契约与旧 Node 版完全一致（4 个持久化端点路径与响应格式不变），
新增的只有：?u=&k= 鉴权、响应里的 viewerUrl、/admin。
"""

import json
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import delete, select

from .admin import router as admin_router
from .auth import current_user, get_session, viewer_url
from .compute import forward
from .config import settings
from .db import init_db
from .models import Doc, Snapshot, TemplateList, User


@asynccontextmanager
async def _lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="paiban-api", docs_url=None, redoc_url=None, lifespan=_lifespan)
# 跨国链路裸传 1.3MB JS 要 20s+；gzip 后 ~300KB。JS/JSON 压缩比高，图片不重复压（sharp 已转 webp）
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=6)
app.include_router(admin_router)


def _now_ms() -> int:
    return int(time.time() * 1000)


async def _read_body(request: Request) -> bytes:
    body = await request.body()
    if len(body) > settings.max_body:
        raise HTTPException(status_code=413, detail="request body too large")
    return body


# ---------------- 健康检查 ----------------


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


# ---------------- 凭证握手（推送前验证用户存在，不读不写任何数据） ----------------


@app.get("/api/verify")
async def verify(user: User = Depends(current_user)) -> dict:
    return {"ok": True, "name": user.name}


# ---------------- 主存档 ----------------


@app.get("/api/doc")
async def get_doc(user: User = Depends(current_user), session=Depends(get_session)) -> dict:
    row = await session.get(Doc, user.id)
    return {
        "raw": row.raw if row else None,
        "at": row.at if row else 0,
        "pushedAt": row.pushed_at if row else 0,
    }


@app.put("/api/doc")
async def put_doc(
    request: Request,
    user: User = Depends(current_user),
    session=Depends(get_session),
) -> dict:
    raw = (await _read_body(request)).decode("utf-8")
    push = request.query_params.get("push") == "1"
    now = _now_ms()
    row = await session.get(Doc, user.id)
    if row:
        row.raw = raw
        row.at = now
        if push:
            row.pushed_at = now
    else:
        row = Doc(user_id=user.id, raw=raw, at=now, pushed_at=now if push else 0)
        session.add(row)
    await session.commit()
    out: dict = {"ok": True, "at": now}
    if push:
        out["pushedAt"] = now
    out["viewerUrl"] = viewer_url(settings.base_url, user.name, user.secret)
    return out


# ---------------- 快照（环形，按用户各算各的） ----------------


@app.get("/api/snapshots")
async def get_snapshots(
    user: User = Depends(current_user), session=Depends(get_session)
) -> dict:
    rows = (
        await session.execute(
            select(Snapshot)
            .where(Snapshot.user_id == user.id)
            .order_by(Snapshot.at.desc())
            .limit(settings.snap_limit)
        )
    ).scalars().all()
    return {
        "v": 1,
        "list": [
            {"at": r.at, "pages": r.pages, "els": r.els, "bytes": r.bytes, "raw": r.raw}
            for r in rows
        ],
    }


@app.put("/api/snapshots")
async def put_snapshots(
    request: Request,
    user: User = Depends(current_user),
    session=Depends(get_session),
) -> dict:
    try:
        parsed = json.loads((await _read_body(request)).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="bad json")
    items = parsed if isinstance(parsed, list) else parsed.get("list") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="list required")

    now = _now_ms()
    for s in items[: settings.snap_limit]:
        at = int(s.get("at") or 0) or now
        values = dict(
            pages=int(s.get("pages") or 0),
            els=int(s.get("els") or 0),
            bytes=int(s.get("bytes") or 0),
            raw=str(s.get("raw") or ""),
        )
        row = (
            await session.execute(
                select(Snapshot).where(Snapshot.user_id == user.id, Snapshot.at == at)
            )
        ).scalar_one_or_none()
        if row:
            for k, v in values.items():
                setattr(row, k, v)
        else:
            session.add(Snapshot(user_id=user.id, at=at, **values))

    # 环形裁剪：只留最近 SNAP_LIMIT 份
    keep = (
        select(Snapshot.id)
        .where(Snapshot.user_id == user.id)
        .order_by(Snapshot.at.desc())
        .limit(settings.snap_limit)
    )
    await session.execute(
        delete(Snapshot).where(
            Snapshot.user_id == user.id, Snapshot.id.not_in(keep)
        )
    )
    await session.commit()
    return {"ok": True}


# ---------------- 模板库 ----------------


@app.get("/api/templates")
async def get_templates(
    user: User = Depends(current_user), session=Depends(get_session)
) -> dict:
    row = await session.get(TemplateList, user.id)
    return {"list": json.loads(row.list_json) if row else []}


@app.put("/api/templates")
async def put_templates(
    request: Request,
    user: User = Depends(current_user),
    session=Depends(get_session),
) -> dict:
    try:
        items = json.loads((await _read_body(request)).decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="bad json")
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="list required")
    row = await session.get(TemplateList, user.id)
    if row:
        row.list_json = json.dumps(items, ensure_ascii=False)
        row.updated_at = _now_ms()
    else:
        session.add(
            TemplateList(
                user_id=user.id, list_json=json.dumps(items, ensure_ascii=False), updated_at=_now_ms()
            )
        )
    await session.commit()
    return {"ok": True, "viewerUrl": viewer_url(settings.base_url, user.name, user.secret)}


# ---------------- 排版计算（转发 Node 计算服务，落库在这里） ----------------


@app.post("/api/elements")
async def post_elements(
    request: Request,
    user: User = Depends(current_user),
    session=Depends(get_session),
) -> Response:
    body = await _read_body(request)
    q = {k: v for k, v in request.query_params.items() if k not in ("u", "k")}
    status, data = await forward("POST", "/api/elements", query=q, content=body,
                                 headers={"content-type": "application/json"})
    doc_raw = data.get("doc") if isinstance(data, dict) else None
    if status == 200 and isinstance(data, dict) and data.get("ok") and isinstance(doc_raw, str) and doc_raw:
        push = q.get("push") != "0"
        now = _now_ms()
        row = await session.get(Doc, user.id)
        if row:
            row.raw = doc_raw
            row.at = now
            if push:
                row.pushed_at = now
        else:
            session.add(Doc(user_id=user.id, raw=doc_raw, at=now, pushed_at=now if push else 0))
        await session.commit()
        data["saved"] = True
        data.pop("doc", None)  # 原始稿只落库，不回传给客户端
        data["viewerUrl"] = viewer_url(settings.base_url, user.name, user.secret)
    return JSONResponse(status_code=status, content=data)


@app.post("/api/layout/validate")
async def post_validate(request: Request) -> Response:
    body = await _read_body(request)
    status, data = await forward("POST", "/api/layout/validate", content=body,
                                 headers={"content-type": "application/json"})
    return JSONResponse(status_code=status, content=data)


@app.get("/api/format/health")
async def format_health() -> Response:
    status, data = await forward("GET", "/api/format/health")
    return JSONResponse(status_code=status, content=data)


@app.post("/api/format")
async def post_format(
    request: Request,
    user: User = Depends(current_user),
    session=Depends(get_session),
) -> Response:
    body = await _read_body(request)
    q = {k: v for k, v in request.query_params.items() if k not in ("u", "k")}
    headers = {}
    if "x-file-name" in request.headers:
        headers["x-file-name"] = request.headers["x-file-name"]
    status, data = await forward("POST", "/api/format", query=q, content=body, headers=headers)
    doc_raw = data.get("doc") if isinstance(data, dict) else None
    if status == 200 and isinstance(data, dict) and data.get("ok") and isinstance(doc_raw, str) and doc_raw:
        now = _now_ms()
        row = await session.get(Doc, user.id)
        if row:
            row.raw = doc_raw
            row.at = now
            row.pushed_at = now
        else:
            session.add(Doc(user_id=user.id, raw=doc_raw, at=now, pushed_at=now))
        await session.commit()
        data["saved"] = True
        data.pop("doc", None)
        data["viewerUrl"] = viewer_url(settings.base_url, user.name, user.secret)
    return JSONResponse(status_code=status, content=data)


# ---------------- 静态托管（dist/ + SPA 兜底），与旧 server.mjs 行为一致 ----------------


@app.get("/{full_path:path}")
async def static_files(full_path: str) -> Response:
    dist = Path(settings.dist_dir).resolve()
    rel = Path(full_path)
    if ".." in rel.parts:
        return Response("bad path", status_code=400)
    file = dist / rel
    if not file.is_file():
        file = dist / "index.html"  # SPA 兜底
    if not file.is_file():
        return JSONResponse(status_code=404, content={"error": "frontend dist not found"})
    if rel.as_posix().startswith("assets/"):
        headers = {"Cache-Control": "public, max-age=2592000, immutable"}
    else:
        headers = {"Cache-Control": "no-cache"}
    return FileResponse(file, headers=headers)
