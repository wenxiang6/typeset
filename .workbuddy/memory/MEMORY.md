
## 排版项目·后端规划
- 用户决定：本版部署不上后端（网页版自动降级 localStorage），下一版用 FastAPI 重写后端。
- 现有 Node+SQLite 后端（server.mjs + electron/persist-api.mjs）保留在仓库，仅桌面版使用其逻辑。
- FastAPI 版接口契约（前端 serverSync.ts 只认这 4 个，改后端别动格式）：
  GET /api/health → {"ok":true}；GET/PUT /api/doc（body 为 doc JSON 原文字符串）；
  GET/PUT /api/snapshots（环形 10 份，{v:1,list:[{at,pages,els,bytes,raw}]}）；
  GET/PUT /api/templates（数组）。

## 打包部署·执行方式
- 用户要求（2026-10-27）：打包（dist:mac/dist:win）、docker build 这类重型操作一律由用户在自己终端执行，AI 只给命令不代跑（沙箱/文件代理会拦截，详见用户级记忆）。
- 本项目打包命令需带镜像源：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ 和 ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/，否则工具链下载 502。跑前先 rm -f release/*.tmp.lock 清残留锁。
