# ---------- 构建阶段 ----------
FROM node:22-alpine AS builder

WORKDIR /app

# pnpm 由 packageManager 字段锁定版本
RUN corepack enable

# 先装依赖，利用 Docker 层缓存
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts：跳过 electron/esbuild 的安装脚本，
# 避免在容器里下载桌面端二进制（前端构建用不到，esbuild 走平台可选依赖照样可用）
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# 纯静态构建：vite build → dist/
RUN pnpm build:http

# ---------- 运行阶段 ----------
# Node 后端一体：静态托管 + node:sqlite 持久化（零 npm 依赖）
#
# 刻意不装 chromium / libreoffice / 字体：
# - 排版走纯 Node（backend/tools/layout：高度估算误差 0.7%），浏览器只服务
#   /api/format 的精确装配——那条路在服务器上直接 501 指路（用 /api/elements）。
# - 镜像因此从 ~1GB 降到 ~200MB，构建从 3~6 分钟降到 1 分钟内。
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=80 DB_PATH=/data/paiban.db

COPY --from=builder /app/dist /app/dist
# 后端整目录：入口 server.mjs、API（api/）、解析与排版引擎（tools/）
COPY backend /app/backend

# SQLite 数据落卷：升级/重建镜像不丢数据
VOLUME /data
EXPOSE 80

CMD ["node", "backend/server.mjs"]
