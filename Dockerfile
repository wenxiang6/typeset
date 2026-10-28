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
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=80 DB_PATH=/data/paiban.db

# LibreOffice Writer：Word 导入转换用（parse.mjs 调 soffice 转 HTML）
# font-noto-cjk：中文字体，保证文档转出来中文不缺字
# chromium：服务器端自动排版用无头浏览器装配版面（客户端就什么环境都不用装）
# apk 源换成阿里云镜像，国内构建快很多
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk add --no-cache libreoffice-writer font-noto-cjk chromium nss freetype harfbuzz ttf-freefont

COPY --from=builder /app/dist /app/dist
COPY server.mjs /app/server.mjs
COPY electron/persist-api.mjs /app/electron/persist-api.mjs
COPY electron/format-api.mjs /app/electron/format-api.mjs
# 排版规则与解析器：/api/format 在服务器上跑，必须一起进镜像
COPY tools/import /app/tools/import
# 语义 JSON 排版（/api/elements）：纯 Node 计算，不需要 chromium
COPY tools/layout /app/tools/layout

# SQLite 数据落卷：升级/重建镜像不丢数据
VOLUME /data
EXPOSE 80

CMD ["node", "server.mjs"]
