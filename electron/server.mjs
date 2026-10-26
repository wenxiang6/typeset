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
 * @param {{ distDir: string, imagesDir: string, tmpDir: string, log?: (msg: string) => void }} opts
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function startServer({ distDir, imagesDir, tmpDir, log = () => {} }) {
  const indexFile = path.join(distDir, 'index.html')

  const route = async (req, res) => {
    const pathname = decodeURIComponent((req.url ?? '/').split('?')[0])

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
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
