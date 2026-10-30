"""一次性迁移：旧 Node 版 SQLite（kv 表 + snapshots 表）→ PostgreSQL。

用法（在 backend-fastapi/ 下）：
    DATABASE_URL=postgresql+asyncpg://... uv run --python 3.12 python -m app.migrate \
        --sqlite /data/paiban.db --name 曹明环 --secret <openssl rand -hex 16 生成>

- 默认用户不存在则创建；已存在则复用（secret 以库里为准）
- doc/docAt/docPushedAt → docs 行；snapshots 全量灌入（环形裁剪交给应用）；templates kv → templates 行
"""

import argparse
import asyncio
import json
import sqlite3
import time

from sqlalchemy import select

from .auth import credential_for
from .db import SessionLocal, init_db
from .models import Doc, Snapshot, TemplateList, User


async def migrate(sqlite_path: str, name: str, secret: str | None) -> None:
    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    kv = {r["k"]: r["v"] for r in conn.execute("SELECT k, v FROM kv")}
    snaps = list(conn.execute("SELECT at, pages, els, bytes, raw FROM snapshots ORDER BY at DESC"))
    conn.close()

    await init_db()
    async with SessionLocal() as s:
        user = (await s.execute(select(User).where(User.name == name))).scalar_one_or_none()
        if user is None:
            user = User(name=name, secret=secret or "", created_at=int(time.time() * 1000))
            s.add(user)
            await s.flush()
            print(f"已创建用户 {name}（id={user.id}）")
        elif secret:
            user.secret = secret
            print(f"用户 {name} 已存在，secret 已更新")
        else:
            print(f"用户 {name} 已存在，沿用库里 secret")

        if kv.get("doc"):
            row = await s.get(Doc, user.id)
            at = int(kv.get("docAt") or 0)
            pushed = int(kv.get("docPushedAt") or 0)
            if row:
                row.raw = kv["doc"]
                row.at = at
                row.pushed_at = pushed
            else:
                s.add(Doc(user_id=user.id, raw=kv["doc"], at=at, pushed_at=pushed))
            print("主存档已迁移")

        existing = {
            r.at for r in (await s.execute(select(Snapshot).where(Snapshot.user_id == user.id))).scalars()
        }
        n = 0
        for r in snaps:
            if r["at"] in existing:
                continue
            s.add(Snapshot(user_id=user.id, at=r["at"], pages=r["pages"], els=r["els"],
                           bytes=r["bytes"], raw=r["raw"]))
            n += 1
        print(f"快照迁移 {n} 份（跳过已存在 {len(snaps) - n} 份）")

        if kv.get("templates"):
            try:
                items = json.loads(kv["templates"])
                if isinstance(items, list):
                    row = await s.get(TemplateList, user.id)
                    payload = json.dumps(items, ensure_ascii=False)
                    if row:
                        row.list_json = payload
                        row.updated_at = int(time.time() * 1000)
                    else:
                        s.add(TemplateList(user_id=user.id, list_json=payload,
                                           updated_at=int(time.time() * 1000)))
                    print(f"模板库迁移（{len(items)} 项）")
            except Exception as e:
                print(f"模板库跳过（不是合法 JSON 数组）：{e}")

        await s.commit()

    k, _ = credential_for(name, secret or "")
    print(f"凭证校验值 k={k}（与 config.json 里算出来的一致即迁移成功）")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sqlite", required=True, help="旧 Node 版 paiban.db 路径")
    ap.add_argument("--name", required=True, help="默认用户名")
    ap.add_argument("--secret", default=None, help="默认用户 secret（openssl rand -hex 16）")
    args = ap.parse_args()
    asyncio.run(migrate(args.sqlite, args.name, args.secret))


if __name__ == "__main__":
    main()
