/**
 * Vite 插件：接收 .doc 上传，解析成编辑器可用的元素列表。
 *
 * 全部在本机完成：textutil 转 HTML → 规则表 → 组件元素 + 图片落盘。
 * 只挂在 dev / preview server 上，不参与生产构建产物。
 */
import path from 'node:path'
import os from 'node:os'
import { mkdir, writeFile, readdir, stat, unlink, readFile } from 'node:fs/promises'
import { parseDocBuffer } from './parse.mjs'
import { extractDocImages } from './images.mjs'
import { buildElements } from './rules.mjs'

const MAX_BYTES = 48 * 1024 * 1024
/** 导入图片保留时长：过期自动清理，避免历史稿件把 public 撑大 */
const IMAGE_TTL = 7 * 24 * 3600 * 1000

/**
 * 导入图片的统一访问前缀。
 *
 * 为什么不直接用 /images/imported/（public 目录）：
 * 刚写入的文件，Vite 的静态中间件第一次请求会走 SPA 兜底（返回 index.html），
 * 浏览器拿到 200 却不是图片 → <img> 解码失败、版面里显示破图。等一会儿再请求才正常。
 * 这里自己读盘，写完立刻可读，不受静态中间件缓存影响。
 */
const IMAGE_PREFIX = '/@imported/'
const SAFE_NAME = /^doc-[\w-]+\.(png|jpe?g|gif|webp)$/i

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

async function pruneImages(dir) {
  try {
    const files = await readdir(dir)
    const now = Date.now()
    for (const f of files) {
      if (!/^doc-[\w-]+\.(png|jpe?g|gif|webp|emf)$/i.test(f)) continue
      const full = path.join(dir, f)
      const info = await stat(full).catch(() => null)
      if (info && now - info.mtimeMs > IMAGE_TTL) await unlink(full).catch(() => {})
    }
  } catch {
    /* 目录不存在等情况忽略 */
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BYTES) {
        reject(new Error('文件超过 48MB，已拒绝'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 直接从磁盘读导入图片（绕开 Vite 静态中间件的首次未命中兜底） */
export async function serveImage(req, res, imagesDir) {
  const name = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, ''))
  if (!SAFE_NAME.test(name)) {
    res.statusCode = 400
    res.end('bad name')
    return
  }
  try {
    const data = await readFile(path.join(imagesDir, name))
    res.statusCode = 200
    res.setHeader('Content-Type', MIME_BY_EXT[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream')
    res.setHeader('Content-Length', String(data.length))
    res.setHeader('Cache-Control', 'no-store')
    res.end(data)
  } catch {
    res.statusCode = 404
    res.end('image not found')
  }
}

/**
 * @param {{ tmpDir?: string, imagesDir: string }} opts
 *   imagesDir：导入图片落盘目录（桌面版放 userData，网页版放 public/images/imported）
 */
export async function handleImport(req, res, opts) {
  const { imagesDir } = opts
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: '只支持 POST' })

  const started = Date.now()
  let buf
  try {
    buf = await readBody(req)
  } catch (err) {
    return send(res, 413, { ok: false, error: String(err.message || err) })
  }
  if (!buf.length) return send(res, 400, { ok: false, error: '空文件' })

  // 魔数校验：OLE2 / ZIP(docx) / RTF
  const isOle = buf.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1'
  const isZip = buf.subarray(0, 2).toString('latin1') === 'PK'
  const isRtf = buf.subarray(0, 5).toString('latin1') === '{\\rtf'
  if (!isOle && !isZip && !isRtf) {
    return send(res, 415, { ok: false, error: '不是 Word / RTF 文档（.doc / .docx / .rtf）' })
  }

  const tmp = path.join(opts.tmpDir ?? os.tmpdir(), `paiban-import-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.doc`)
  try {
    const { blocks } = await parseDocBuffer(buf, tmp)

    // 图片落盘：doc-<时间戳>-N.png
    const stamp = Date.now().toString(36)
    const dir = imagesDir
    const images = []
    if (isOle) {
      const found = extractDocImages(buf)
      if (found.length) {
        await mkdir(dir, { recursive: true })
        void pruneImages(dir)
      }
      for (let i = 0; i < found.length; i++) {
        const img = found[i]
        const ext = img.mime === 'image/emf' ? 'emf' : img.mime.split('/')[1] || 'png'
        const name = `doc-${stamp}-${i + 1}.${ext}`
        try {
          await writeFile(path.join(dir, name), img.data)
          images.push({ url: `${IMAGE_PREFIX}${name}`, width: img.width, height: img.height, mime: img.mime })
        } catch {
          images.push({ url: '', width: img.width, height: img.height, mime: img.mime })
        }
      }
    }

    const built = buildElements(blocks, { images })
    const usable = images.filter((i) => i.url)
    const warnings = [...built.warnings]
    if (images.length && usable.length < images.length) {
      warnings.push(`${images.length - usable.length} 张图片写入失败，已改为占位框`)
    }
    if (!images.length) warnings.push('原稿未检测到内嵌图片')

    send(res, 200, {
      ok: true,
      elapsed: Date.now() - started,
      paragraphs: blocks.filter((b) => !b.empty).length,
      elements: built.elements,
      masthead: built.masthead,
      header: built.header,
      footer: built.footer,
      meta: built.meta,
      images: usable,
      warnings,
    })
  } catch (err) {
    send(res, 500, { ok: false, error: String(err?.message || err) })
  }
}

export function docImportPlugin() {
  const attach = (server) => {
    const root = server.config.root
    const imagesDir = path.join(root, 'public', 'images', 'imported')
    server.middlewares.use('/@doc-import', (req, res) => {
      handleImport(req, res, { imagesDir }).catch((err) => send(res, 500, { ok: false, error: String(err?.message || err) }))
    })
    server.middlewares.use('/@imported', (req, res) => {
      serveImage(req, res, imagesDir).catch(() => {
        res.statusCode = 500
        res.end('read error')
      })
    })
  }
  return {
    name: 'paiban-doc-import',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
