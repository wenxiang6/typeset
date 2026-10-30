"""测试会话开始前清掉残留的 SQLite 文件库，保证每次都是干净状态。"""

import os
import glob

import pytest


@pytest.fixture(scope="session", autouse=True)
def _clean_db():
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for f in glob.glob(os.path.join(here, "test.db*")):
        os.remove(f)
    yield
