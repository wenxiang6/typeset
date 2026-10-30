# 排版计算服务（Node 22，内部端口 9706，只算不存）
# 构建上下文必须是仓库根（需要 backend/ 和 dist/）：
#   docker build -f backend-fastapi/compute.Dockerfile -t paiban-compute .
FROM node:22-slim
WORKDIR /srv

COPY backend ./backend
COPY dist ./dist

# sharp（图片压缩）是 backend 唯一的运行时 npm 依赖；playwright-core 是 devDep，不装
RUN cd /srv/backend && npm install --omit=dev

ENV PORT=9706
EXPOSE 9706
CMD ["node", "backend/compute-server.mjs"]
