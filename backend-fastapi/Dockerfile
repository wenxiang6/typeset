FROM python:3.12-slim
WORKDIR /srv

COPY pyproject.toml ./
COPY app ./app

RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ \
    "fastapi>=0.115" "uvicorn[standard]>=0.30" "sqlalchemy[asyncio]>=2.0" \
    "asyncpg>=0.29" "httpx>=0.27" "aiosqlite>=0.20" "python-multipart>=0.0.9"

ENV DIST_DIR=/srv/dist
EXPOSE 80
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "80"]
