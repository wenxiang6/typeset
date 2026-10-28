#!/usr/bin/env node
/**
 * 排版编辑器 · 部署服务器入口（替代 nginx）
 *
 * 一个进程干两件事：
 * 1. 静态托管 dist/（SPA 兜底 index.html）
 * 2. SQLite 持久化 API：主存档 / 快照（环形 10 份）/ 模板库
 *    实现在 electron/persist-api.mjs，与桌面版共用
 *
 * 零 npm 依赖：SQLite 用 Node 22 内置的 node:sqlite。
 * 数据文件默认 /data/paiban.db（Docker 卷），本地开发自动回退到脚本同目录。
 */
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPersistApi } from './api/persist-api.mjs'
import { createFormatApi } from './api/format-api.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 构建产物在仓库根 dist/，本文件在 backend/ 下
const DIST = path.join(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT || 80)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'paiban.db')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
}

function serveStatic(res, pathname) {
  let rel
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    res.writeHead(400)
    return res.end('bad path')
  }
  if (rel.includes('..')) {
    res.writeHead(400)
    return res.end('bad path')
  }
  let file = path.join(DIST, rel)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html') // SPA 兜底
  }
  const ext = path.extname(file).toLowerCase()
  const cache = pathname.startsWith('/assets/')
    ? 'public, max-age=2592000, immutable'
    : 'no-cache'
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache })
  fs.createReadStream(file).pipe(res)
}

const persistApi = await createPersistApi({ dbPath: DB_PATH, log: (m) => console.log(`[paiban] ${m}`) })
// 服务器端自动排版：客户端只发 HTTP，解析+装配+落库全在这里完成
const formatApi = createFormatApi({
  persist: persistApi,
  distDir: DIST,
  port: PORT,
  log: (m) => console.log(`[paiban] ${m}`),
})

const server = createServer(async (req, res) => {
  const { pathname: p } = new URL(req.url, 'http://localhost')
  try {
    if (await formatApi.handle(req, res, p)) return
    if (await persistApi.handle(req, res, p)) return
    return serveStatic(res, p)
  } catch (err) {
    console.error('[paiban-server]', req.method, p, err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String(err?.message || err) }))
    } else {
      res.end()
    }
  }
})

server.listen(PORT, () => {
  console.log(`[paiban] http://0.0.0.0:${PORT}  db: ${DB_PATH}`)
})
