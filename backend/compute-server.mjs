#!/usr/bin/env node
/**
 * 排版计算服务（内部，不对公网暴露）
 *
 * Docker Compose 里和 FastAPI 网关配对使用：
 *   公网 → FastAPI(9705) ─ 转发 → 本服务(9706)
 *
 * 只做计算，不碰存储：
 * - POST /api/elements        语义 JSON → 版面，响应带 doc（raw 字符串），由网关落库
 * - POST /api/layout/validate 只校验
 * - POST /api/format          原稿直传（需要 Chromium，没装返回 501）
 * - GET  /api/format/health   自检
 * - GET  /format.html + /images/*  浏览器装配页和图片（仅 /api/format 流程内部用）
 *
 * 存储（主存档/快照/模板/用户/鉴权/静态站点托管）全部在 FastAPI 网关 + PostgreSQL。
 */
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFormatApi } from './api/format-api.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT || 9706)

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
  '.ico': 'image/x-ico',
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
  const file = path.join(DIST, rel)
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ error: 'not found' }))
  }
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

const formatApi = createFormatApi({
  persist: null,
  distDir: DIST,
  port: PORT,
  returnDoc: true, // 只算不存：doc 由网关按用户落库
  log: (m) => console.log(`[compute] ${m}`),
})

const server = createServer(async (req, res) => {
  const { pathname: p } = new URL(req.url, 'http://localhost')
  try {
    if (await formatApi.handle(req, res, p)) return
    if (p === '/format.html' || p.startsWith('/images/')) return serveStatic(res, p)
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'not found' }))
  } catch (err) {
    console.error('[compute]', req.method, p, err)
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String(err?.message || err) }))
    } else {
      res.end()
    }
  }
})

server.listen(PORT, () => {
  console.log(`[compute] http://0.0.0.0:${PORT}  dist: ${DIST}  (compute-only, no persistence)`)
})
