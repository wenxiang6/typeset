"""SQLAlchemy 2.0 模型。外键全部 ON DELETE CASCADE，删用户即清其全部数据。"""

from sqlalchemy import BigInteger, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    secret: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class Doc(Base):
    """每人一份主存档。at=最后写入时间，pushed_at=最后一次外部推送时间（前端轮询用）。"""

    __tablename__ = "docs"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    raw: Mapped[str] = mapped_column(Text, nullable=False)
    at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    pushed_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)


class Snapshot(Base):
    """快照，环形上限 SNAP_LIMIT，按用户各算各的。(user_id, at) 唯一，重复写入即覆盖。"""

    __tablename__ = "snapshots"
    __table_args__ = (UniqueConstraint("user_id", "at", name="uq_snap_user_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    at: Mapped[int] = mapped_column(BigInteger, nullable=False)
    pages: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    els: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    raw: Mapped[str] = mapped_column(Text, nullable=False, default="")


class TemplateList(Base):
    """模板库，前端按整份列表读写，所以每人存一行 JSON（user_id 为 NULL 预留全局共享）。"""

    __tablename__ = "templates"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    list_json: Mapped[str] = mapped_column("list", Text, nullable=False, default="[]")
    updated_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
