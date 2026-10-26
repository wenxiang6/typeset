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
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
