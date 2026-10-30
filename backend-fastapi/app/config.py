"""配置：全部走环境变量，Docker 里由 compose 注入。"""

import os
from dataclasses import dataclass


def _env(key: str, default: str) -> str:
    v = os.environ.get(key)
    return v if v else default


@dataclass(frozen=True)
class Settings:
    # 生产: postgresql+asyncpg://paiban:密码@postgres:5432/paiban
    # 开发/测试可用 sqlite+aiosqlite:///./paiban.db
    database_url: str = _env("DATABASE_URL", "sqlite+aiosqlite:///./paiban.db")
    # 排版计算服务（Node，内部）
    compute_url: str = _env("COMPUTE_URL", "http://127.0.0.1:9706")
    # 拼访问链接用，如 http://47.253.176.114:9705
    base_url: str = _env("BASE_URL", "http://127.0.0.1:9705")
    # 管理后台密钥（必须设置才能用 /admin）
    admin_secret: str = _env("ADMIN_SECRET", "")
    # 前端 dist 目录（绝对路径或相对本目录）
    dist_dir: str = _env("DIST_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "dist"))
    # 快照环形上限，与旧版一致
    snap_limit: int = int(_env("SNAP_LIMIT", "10"))
    # 请求体上限（doc/快照可能很大）
    max_body: int = int(_env("MAX_BODY", str(20 * 1024 * 1024)))


settings = Settings()
