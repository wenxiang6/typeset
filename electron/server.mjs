/**
 * 桌面版的本地 HTTP 服务
 *
 * 为什么桌面版还要起一个本地服务，而不是 file:// 加载：
 * - 页面里的 fetch('/@doc-import') 需要 http 源
 * - 导入的图片、本地磁盘图片（/@local）都要经过一层「按白名单读盘」的代理，
 *   file:// 下浏览器不允许 http 页面读本地文件
 * 服务只监听 127.0.0.1 的随机端口，不对外，也不联网。
 */
import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { handleImport, serveImage } from '../tools/import/server-plugin.mjs'
import { createPersistApi } from './persist-api.mjs'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
}

/** 只允许读取这些扩展名的本地图片（/@local 代理） */
const LOCAL_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif'])

function sendStatic(res, file) {
  const ext = path.extname(file).toLowerCase()
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
  res.setHeader('Cache-Control', ext === '.html' ? 'no-store' : 'public, max-age=3600')
  fs.createReadStream(file)
    .on('error', () => {
      res.statusCode = 500
      res.end('read error')
    })
    .pipe(res)
}

/** /@local/<绝对路径> → 直接读本机磁盘上的图片 */
async function serveLocalImage(req, res) {
  try {
    const abs = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\/?/, ''))
    const normalized = path.normalize(abs)
    if (!path.isAbsolute(normalized) || !LOCAL_IMAGE_EXT.has(path.extname(normalized).toLowerCase())) {
      res.statusCode = 400
      res.end('bad path')
      return
    }
    const data = await fsp.readFile(normalized)
    res.statusCode = 200
    res.setHeader('Content-Type', MIME[path.extname(normalized).toLowerCase()] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-store')
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end('local image not found')
  }
}

/**
 * @param {{
 *   distDir: string, imagesDir: string, tmpDir: string,
 *   host?: string, port?: number, allowLocal?: boolean,
 *   dbPath?: string, log?: (msg: string) => void
 * }} opts
 *   dbPath：SQLite 数据文件路径；传入即启用存档/快照/模板库持久化 API（桌面版传 userData 下路径）
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function startServer({
  distDir,
  imagesDir,
  tmpDir,
  host = '127.0.0.1',
  port = 0,
  allowLocal = true,
  dbPath,
  log = () => {},
}) {
  const indexFile = path.join(distDir, 'index.html')
  const persistApi = dbPath ? await createPersistApi({ dbPath, log }) : null

  const route = async (req, res) => {
    const pathname = decodeURIComponent((req.url ?? '/').split('?')[0])

    // 持久化 API：主存档 / 快照 / 模板库（降级时 health 返回 503，前端自动退回 localStorage）
    if (persistApi && (await persistApi.handle(req, res, pathname))) return

    if (pathname === '/@doc-import') {
      // 挂载前缀要剥掉，handleImport 只认请求体
      req.url = '/'
      await handleImport(req, res, { imagesDir, tmpDir })
      return
    }

    if (pathname.startsWith('/@imported/')) {
      req.url = pathname.slice('/@imported'.length)
      await serveImage(req, res, imagesDir)
      return
    }

    if (pathname.startsWith('/@local/')) {
      // @local 是「代读本机磁盘」的能力；对外监听时必须关掉，否则等于开放服务器文件读取
      if (!allowLocal) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: '对外服务已禁用本地磁盘代读' }))
        return
      }
      req.url = pathname.slice('/@local/'.length)
      await serveLocalImage(req, res)
      return
    }

    // 静态资源：dist 下的真实文件；其余（含 #/preview 之类的前端路由）一律回 index.html
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const file = path.join(distDir, rel)
    if (file.startsWith(distDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      sendStatic(res, file)
      return
    }
    sendStatic(res, indexFile)
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((err) => {
      log(`请求失败 ${req.url}: ${err?.message || err}`)
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }))
      }
    })
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  const { port: actualPort } = server.address()
  const displayHost = host.includes(':') ? `[${host}]` : host
  return {
    port: actualPort,
    url: `http://${displayHost}:${actualPort}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
