"""全链路测试：鉴权 / 主存档 / 快照环形 / 模板 / 计算转发落库 / admin。

跑法（backend-fastapi/ 下，本机 SQLite，无需 Docker）：
    DATABASE_URL=sqlite+aiosqlite:///./test.db uv run --python 3.12 pytest -q
"""

import hashlib
import json
import os
import time

import pytest
from httpx import ASGITransport, AsyncClient, Response as HttpxResponse

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test.db")
os.environ.setdefault("BASE_URL", "http://test:9705")
os.environ.setdefault("ADMIN_SECRET", "admin-test-secret")
os.environ.setdefault("DIST_DIR", "/nonexistent")

from app.auth import md5_hex  # noqa: E402
from app.compute import forward as real_forward  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.db import SessionLocal  # noqa: E402

NAME = "测试用户"
SECRET = "abcdef0123456789abcdef0123456789"
K = md5_hex(f"{NAME}:{SECRET}")
AUTH = {"u": NAME, "k": K}


async def ensure_user() -> None:
    from sqlalchemy import select

    async with SessionLocal() as s:
        row = (await s.execute(select(User).where(User.name == NAME))).scalar_one_or_none()
        if row is None:
            s.add(User(name=NAME, secret=SECRET, created_at=int(time.time() * 1000)))
            await s.commit()


@pytest.fixture(autouse=True)
async def _db():
    from app.db import init_db

    await init_db()
    yield


def client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def fake_forward(method, path, **kw):
    """打桩的「计算服务」：返回一份最小 doc，验证网关按用户落库。"""
    if path == "/api/elements":
        return 200, {"ok": True, "pages": 2, "elements": 9, "chars": 123,
                     "report": {}, "warnings": [], "saved": False,
                     "doc": json.dumps({"pages": [{"els": []}]})}
    if path == "/api/layout/validate":
        return 200, {"ok": True, "errors": [], "warnings": []}
    return 404, {"error": "not found"}


# ---------------- 鉴权 ----------------


async def test_health_public():
    async with client() as c:
        assert (await c.get("/api/health")).json() == {"ok": True}


async def test_doc_requires_auth():
    async with client() as c:
        assert (await c.get("/api/doc")).status_code == 401
        bad = {**AUTH, "k": "wrong"}
        assert (await c.get("/api/doc", params=bad)).status_code == 401
        assert (await c.get("/api/doc", params={"u": NAME})).status_code == 401


async def test_wrong_user_401():
    async with SessionLocal() as s:
        s.add(User(name="张三", secret="s2", created_at=0))
        await s.commit()
    async with client() as c:
        r = await c.get("/api/doc", params={"u": "张三", "k": K})
        assert r.status_code == 401  # 拿别人的 k 冒充不行


# ---------------- 主存档 ----------------


async def test_doc_put_get_push():
    await ensure_user()
    async with client() as c:
        r = await c.put("/api/doc", params={**AUTH, "push": "1"}, content='{"pages":1}')
        j = r.json()
        assert j["ok"] is True and j["pushedAt"] == j["at"]
        assert "viewerUrl" in j and f"u={NAME}" in j["viewerUrl"] and j["viewerUrl"].endswith(f"k={K}")

        # 不带 push=1 的镜像写入：只更新 at，不动 pushedAt
        r2 = await c.put("/api/doc", params=AUTH, content='{"pages":2}')
        j2 = r2.json()
        assert "pushedAt" not in j2

        g = (await c.get("/api/doc", params=AUTH)).json()
        assert g["raw"] == '{"pages":2}'
        assert g["pushedAt"] == j["pushedAt"] and g["at"] == j2["at"]


# ---------------- 快照环形 ----------------


async def test_snapshots_ring_per_user():
    await ensure_user()
    async with client() as c:
        now = int(time.time() * 1000)
        items = [{"at": now - i, "pages": i, "els": i, "bytes": i * 100, "raw": f"s{i}"} for i in range(15)]
        assert (await c.put("/api/snapshots", params=AUTH, json={"v": 1, "list": items})).json() == {"ok": True}
        got = (await c.get("/api/snapshots", params=AUTH)).json()
        assert got["v"] == 1 and len(got["list"]) == 10  # 环形裁到 10
        assert got["list"][0]["raw"] == "s0"  # 最新在前
        # 重复写同一 at 是覆盖，不重复
        await c.put("/api/snapshots", params=AUTH, json={"list": [{"at": now, "pages": 99, "els": 0, "bytes": 0, "raw": "dup"}]})
        got2 = (await c.get("/api/snapshots", params=AUTH)).json()
        assert len(got2["list"]) == 10 and got2["list"][0]["raw"] == "dup"


# ---------------- 模板库 ----------------


async def test_templates_roundtrip():
    await ensure_user()
    async with client() as c:
        assert (await c.get("/api/templates", params=AUTH)).json() == {"list": []}
        await c.put("/api/templates", params=AUTH, json=[{"id": "t1"}])
        assert (await c.get("/api/templates", params=AUTH)).json() == {"list": [{"id": "t1"}]}
        assert (await c.put("/api/templates", params=AUTH, content="notjson")).status_code == 400
        assert (await c.put("/api/templates", params=AUTH, json={"x": 1})).status_code == 400


# ---------------- 计算服务转发 ----------------


async def test_elements_forward_and_persist(monkeypatch):
    await ensure_user()
    monkeypatch.setattr("app.main.forward", fake_forward)
    async with client() as c:
        body = json.dumps({"version": 1, "blocks": []})
        r = await c.post("/api/elements", params={**AUTH, "push": "1"}, content=body.encode())
        j = r.json()
        assert j["ok"] is True and j["saved"] is True and "doc" not in j  # doc 不外泄，只落库
        g = (await c.get("/api/doc", params=AUTH)).json()
        assert g["raw"] == json.dumps({"pages": [{"els": []}]})
        assert g["pushedAt"] > 0


async def test_elements_compute_down(monkeypatch):
    await ensure_user()
    async def down(method, path, **kw):
        return 502, {"ok": False, "error": "计算服务不可用"}
    monkeypatch.setattr("app.main.forward", down)
    async with client() as c:
        r = await c.post("/api/elements", params=AUTH, content="{}")
        assert r.status_code == 502


async def test_validate_is_public(monkeypatch):
    monkeypatch.setattr("app.main.forward", fake_forward)
    async with client() as c:
        assert (await c.post("/api/layout/validate", content="{}")).status_code == 200


# ---------------- admin ----------------


async def test_admin_flow():
    async with client() as c:
        # 未登录看不到用户列表
        r = await c.get("/admin-legacy")
        assert "管理员密钥" in r.text and "测试用户" not in r.text
        # 错误密钥进不去
        r = await c.post("/admin-legacy/login", data={"password": "nope"}, follow_redirects=False)
        assert "密钥不对" in r.text
        # 正确密钥 → cookie → 列表可见
        r = await c.post("/admin-legacy/login", data={"password": "admin-test-secret"}, follow_redirects=False)
        assert r.status_code == 303
        page = (await c.get("/admin-legacy")).text
        assert NAME in page
        # 新增用户：返回一次性凭证
        r = await c.post("/admin-legacy/users/add", data={"name": "李四"})
        assert "只展示这一次" in r.text and "李四" in r.text
        # 新用户的凭证直接可用
        import re
        m = re.search(r"secret：<code>([0-9a-f]{32})</code>", r.text)
        k2 = md5_hex(f"李四:{m.group(1)}")
        assert (await c.get("/api/doc", params={"u": "李四", "k": k2})).status_code == 200
        # 删除用户 → 凭证立即失效（级联清数据）
        await c.post("/admin-legacy/users/delete", data={"name": "李四"})
        assert (await c.get("/api/doc", params={"u": "李四", "k": k2})).status_code == 401


async def test_admin_spa_route_serves_frontend():
    """/admin 必须返回 SPA（React 后台），而不是后端渲染的 HTML 页。"""
    async with client() as c:
        r = await c.get("/admin")
        # dist 不在测试环境里时返回 404 JSON；关键是不能出现后端 HTML 的特征
        assert "管理员密钥" not in r.text


async def test_admin_json_api():
    """React 后台管理页走的 /api/admin/* JSON 接口。"""
    await ensure_user()
    async with client() as c:
        # 未登录：session 探测 401，用户列表 401
        assert (await c.get("/api/admin/session")).status_code == 401
        assert (await c.get("/api/admin/users")).status_code == 401
        # 密码错误 401
        r = await c.post("/api/admin/login", json={"password": "wrong"})
        assert r.status_code == 401
        # 登录成功 → cookie 生效
        assert (await c.post("/api/admin/login", json={"password": "admin-test-secret"})).json() == {"ok": True}
        assert (await c.get("/api/admin/session")).json() == {"ok": True}
        # 列表能看到已有用户
        users = (await c.get("/api/admin/users")).json()["users"]
        assert any(u["name"] == NAME for u in users)
        # 新增：返回一次性凭证，且凭证当场可用
        r = await c.post("/api/admin/users", json={"name": "王五"})
        j = r.json()
        assert j["ok"] is True and "/view?u=王五&k=" in j["viewerUrl"]
        k5 = md5_hex(f"王五:{j['secret']}")
        assert (await c.get("/api/doc", params={"u": "王五", "k": k5})).status_code == 200
        # 重名 409
        assert (await c.post("/api/admin/users", json={"name": "王五"})).status_code == 409
        # 重置：新 secret 生效，旧的失效
        r = await c.post("/api/admin/users/王五/reset")
        j2 = r.json()
        assert j2["secret"] != j["secret"]
        k5b = md5_hex(f"王五:{j2['secret']}")
        assert (await c.get("/api/doc", params={"u": "王五", "k": k5b})).status_code == 200
        assert (await c.get("/api/doc", params={"u": "王五", "k": k5})).status_code == 401
        # 删除 → 401
        assert (await c.request("DELETE", "/api/admin/users/王五")).json() == {"ok": True}
        assert (await c.get("/api/doc", params={"u": "王五", "k": k5b})).status_code == 401
        # 登出 → 接口又不可用
        await c.post("/api/admin/logout")
        assert (await c.get("/api/admin/users")).status_code == 401


async def test_admin_tree_and_json():
    """稿件与模板树 + 原文查看/下载。"""
    await ensure_user()
    async with client() as c:
        await c.put("/api/doc", params={**AUTH, "push": "1"}, content=json.dumps({"pages": [{"els": []}, {"els": []}]}))
        await c.put("/api/templates", params=AUTH, json=[{"id": "t1", "name": "模板一", "at": 1730000000000}])
        # 登录
        await c.post("/api/admin/login", json={"password": "admin-test-secret"})
        # 树：主稿 + 模板
        tree = (await c.get("/api/admin/tree")).json()["tree"]
        me = next(t for t in tree if t["name"] == NAME)
        assert me["doc"]["pages"] == 2 and me["doc"]["bytes"] > 0
        assert me["templates"][0]["name"] == "模板一" and me["templates"][0]["at"] == 1730000000000
        # 原文：主稿
        r = await c.get("/api/admin/json", params={"user": NAME, "target": "doc"})
        assert '"pages"' in r.text
        # 原文：模板
        r = await c.get("/api/admin/json", params={"user": NAME, "target": "tpl:t1"})
        assert "模板一" in r.text
        # 下载头
        r = await c.get("/api/admin/json", params={"user": NAME, "target": "tpl:t1", "download": 1})
        assert "attachment" in r.headers.get("content-disposition", "")
        # 模板不存在 404
        assert (await c.get("/api/admin/json", params={"user": NAME, "target": "tpl:nope"})).status_code == 404
        # 非法 target 400
        assert (await c.get("/api/admin/json", params={"user": NAME, "target": "x"})).status_code == 400


async def test_admin_login_rate_limit():
    """连错 5 次锁 10 分钟，锁定期内正确密码也进不来。"""
    async with client() as c:
        for _ in range(5):
            assert (await c.post("/api/admin/login", json={"password": "bad"})).status_code == 401
        assert (await c.post("/api/admin/login", json={"password": "bad"})).status_code == 429
        assert (await c.post("/api/admin/login", json={"password": "admin-test-secret"})).status_code == 429
