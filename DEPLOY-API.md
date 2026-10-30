# 服务器版部署（FastAPI 网关 + Node 计算服务 + PostgreSQL）

架构：公网 → **api**（FastAPI，9705，鉴权 + PG 存储 + 静态托管 + /admin）
　　　　　　　　　　└ 内部 → **compute**（Node，9706，排版计算，只算不存）
　　　　　　　　　　└ **postgres**（16，数据卷）

## 一次性部署（全部在【服务器】上执行）

前置：服务器装好 Docker（含 compose 插件）和 git；仓库同步到服务器（git clone 或 rsync）。
dist/ 两种来法任选：服务器上 `cd frontend && pnpm install && pnpm build`，
或本地构建后 `rsync -av dist/ 服务器:/path/to/paiban/dist/`。

```bash
cd /path/to/paiban        # 服务器上的仓库目录

# 1. 环境变量
cp .env.example .env
# 编辑 .env：BASE_URL=http://47.253.176.114:9705
#            ADMIN_SECRET=$(openssl rand -hex 16)
#            POSTGRES_PASSWORD=$(openssl rand -hex 16)

# 2. 确认 dist/ 存在（pnpm build 产物；FastAPI 托管它）

# 3. 起全套（三容器：postgres + compute + api）
docker compose up -d --build

# 4. 验证
curl -s http://127.0.0.1:9705/api/health         # {"ok":true}
curl -s http://127.0.0.1:9705/api/format/health  # 计算服务自检

# 5. 迁移老数据（旧 Node 版 SQLite → PostgreSQL，一次性）
#    旧库一般在服务器 /data/paiban.db（旧容器数据卷），拷进 api 容器里跑：
docker compose cp /data/paiban.db api:/tmp/paiban.db
docker compose exec api python -m app.migrate \
  --sqlite /tmp/paiban.db --name <你的名字> --secret <openssl rand -hex 16>
```

## 建用户（两种方式等价）

- 后台：浏览器开 `http://<服务器>:9705/admin` → 输入 ADMIN_SECRET → 新增用户 → 页面会显示一次性凭证（name / secret / 访问链接），同时抄进本地 skill 的 config.json
- 或直接往后台页面里看（列表可重置/删除）

## 验证清单（部署后过一遍）

1. `curl -s $BASE/api/health` → `{"ok":true}`
2. 无凭证 `curl -s -o /dev/null -w '%{http_code}' $BASE/api/doc` → **401**
3. 用 admin 发的链接打开网页 → 能看到（迁移来的）版面，能编辑保存
4. 本机跑 skill 推送：链接里带 `&u=&k=` 的推送应成功，响应带 `viewerUrl`
5. `/admin` 列表能看到该用户、最后活跃时间在更新

## 日常运维

```bash
# 更新版本：
cd frontend && pnpm build && cd .. && docker compose up -d --build

# 备份与探活（上线多用户前必须配好，一次安装）：
chmod +x ops/backup.sh ops/healthcheck.sh
crontab -e
#   15 3 * * * /path/to/paiban/ops/backup.sh >> /path/to/paiban/ops/backup.log 2>&1
#   */5 * * * * /path/to/paiban/ops/healthcheck.sh >> /path/to/paiban/ops/health.log 2>&1

# 手动备份：
ops/backup.sh
# 恢复：
cat ops/backups/paiban-2026-10-30.dump | docker exec -i paiban-postgres-1 pg_restore -U paiban -d paiban --clean
```

## 与旧版的差异

- 4 个持久化端点路径/格式不变，但**全部需要凭证**（?u=&k=）
- 响应多一个 `viewerUrl`（后端拼好的带凭证访问链接）
- 排版引擎仍是 Node（`backend/tools/`），以内部 compute 服务存在，未重写
- 桌面版（electron）已移除；`pnpm build` 即 `vite build`
