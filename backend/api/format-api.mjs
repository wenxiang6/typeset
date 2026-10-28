/**
 * 服务器端自动排版 API
 *
 * 目的：让「任何设备 + 任何 AI 工具」都能排版——客户端只要能发一个 HTTP 请求，
 * 不用装 Node、不用装浏览器、不用装字体。全部计算在服务器上完成。
 *
 * 端点：
 * - POST /api/format           body = 文件原始字节，X-File-Name 带文件名（可选扩展名）
 *                              → 解析成元素 → 无头 Chromium 装配 → 落库 → 返回页数
 * - GET  /api/format/payload   装配页拿元素用（内部）
 * - POST /api/format/result    装配页回传结果用（内部）
 * - GET  /api/format/health    自检：转换器 / 浏览器 / 字体是否齐
 *
 * 为什么必须起浏览器：装配要按栏宽量真实高度（分栏 / 避让 / 溢出翻页 / 按行切割），
 * 脱离 DOM 算不出坐标。所以服务器跑一次无头 Chromium，把结果回传落库。
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseDocFile } from '../tools/import/parse.mjs'
import { buildElements } from '../tools/import/rules.mjs'
import { extractDocImages } from '../tools/import/images.mjs'
import { normalizeLayout, validateLayout } from '../tools/layout/schema.mjs'
import { buildDoc } from '../tools/layout/geometry.mjs'

const MAX_BYTES = 48 * 1024 * 1024
const JOB_TTL = 5 * 60 * 1000
const JOB_TIMEOUT = 90 * 1000

const TEXT_EXT = /\.(txt|md|markdown)$/i

function json(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function readBody(req, limit = MAX_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('文件超过 48MB'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 找系统里的 Chromium：优先环境变量，其次各发行版常见路径 */
async function findChromium() {
  const cand = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/lib/chromium/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean)
  for (const p of cand) {
    try {
      await fsp.access(p, fs.constants.X_OK)
      return p
    } catch {
      /* 下一个 */
    }
  }
  return null
}

/** 纯文本 / Markdown：不劳烦 LibreOffice，直接按行切块，交给 textMode 规则识别 */
function plainBlocks(buf) {
  const text = buf.toString('utf8').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const blocks = []
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    // Markdown 语法糖去掉，只留文字：标题、列表符号、加粗星号
    const clean = t
      .replace(/^#{1,6}\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .trim()
    if (!clean) continue
    blocks.push({
      tag: 'p',
      cls: 'p1',
      text: clean,
      runs: [{ text: clean, bold: false }],
      html: clean,
      fontSize: 10.5,
      family: '',
      align: 'left',
      marginTop: 0,
      indent: 0,
      color: '',
      bold: false,
      empty: false,
    })
  }
  return blocks
}

/**
 * 按请求参数改页眉 / 页脚 / 水印。改的是装配好的 doc，所以每页都跟着变。
 * @param {any} doc
 * @param {Record<string, string>} o
 */
function applyOverrides(doc, o) {
  for (const p of doc.pages ?? []) {
    for (const el of p.els ?? []) {
      if (el.variant === 'header' && typeof el.html === 'string') {
        if (o.journal) el.html = el.html.replace(/(<div class="header-title">)[^<]*(\s*<span>)/, `$1${o.journal}$2`)
        if (o.issue) el.html = el.html.replace(/(<div class="issue">)[^<]*(<\/div>)/, `$1${o.issue}$2`)
        if (o.date)
          el.html = el.html.replace(/(<div class="issue">[^<]*<\/div><div>)[^<]*(<\/div>)/, `$1${o.date}$2`)
      }
      if (el.variant === 'footer' && typeof el.html === 'string') {
        if (o.date) el.html = el.html.replace(/使用日期：[^<]*/, `使用日期：${o.date}`)
        if (o.editor) el.html = el.html.replace(/编辑：[^<]*/, `编辑：${o.editor}`)
        if (o.proofreader) el.html = el.html.replace(/核对：[^<]*/, `核对：${o.proofreader}`)
      }
    }
  }
  if (o.watermark && doc.watermark) doc.watermark = { ...doc.watermark, text: o.watermark }
  return doc
}

/**
 * @param {{ persist: { writeDoc: (raw: string, push?: boolean) => boolean }, distDir: string, port: number, log?: (s: string) => void }} opts
 */
export function createFormatApi({ persist, distDir, port, log = () => {} }) {
  /** @type {Map<string, { payload: any, resolve: (v: any) => void, reject: (e: any) => void, at: number }>} */
  const jobs = new Map()
  /** 串行队列：同时起多个 Chromium 会把小内存机器打爆 */
  let queue = Promise.resolve()
  let chromiumPath = null

  const imageDir = path.join(distDir, 'images', 'imported')

  // 过期任务清理
  setInterval(() => {
    const now = Date.now()
    for (const [id, job] of jobs) if (now - job.at > JOB_TTL) jobs.delete(id)
  }, 60_000).unref?.()

  /** 起一次无头浏览器，让它打开装配页并回传结果 */
  async function runBrowser(jobId, orientation) {
    const exe = chromiumPath ?? (chromiumPath = await findChromium())
    if (!exe) throw new Error('服务器没装 Chromium（apk add chromium / apt install chromium）')

    const url = `http://127.0.0.1:${port}/format.html?job=${encodeURIComponent(jobId)}&orientation=${orientation}`
    const profile = path.join(os.tmpdir(), `paiban-prof-${jobId}`)
    const proc = spawn(
      exe,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--disable-extensions',
        '--disable-background-networking',
        '--window-size=1400,1000',
        `--user-data-dir=${profile}`,
        url,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )

    let stderr = ''
    proc.stderr.on('data', (c) => {
      stderr += String(c)
      if (stderr.length > 8000) stderr = stderr.slice(-8000)
    })

    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`浏览器装配超时（${JOB_TIMEOUT / 1000}s）`)), JOB_TIMEOUT)
      proc.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`浏览器提前退出（code ${code}）${stderr ? '：' + stderr.slice(-300) : ''}`))
      })
      jobs.get(jobId).resolve = (v) => {
        clearTimeout(timer)
        resolve(v)
      }
    })

    try {
      return await done
    } finally {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* 已退出 */
      }
      fsp.rm(profile, { recursive: true, force: true }).catch(() => {})
    }
  }

  /** 内联图片（dataUrl / base64）落盘，并把 src 换成可访问路径 */
  function saveInlineImages(layout) {
    const warnings = []
    for (const b of layout.blocks) {
      if (b.type !== 'image') continue
      const data = b.dataUrl || b.data
      if (!data) continue
      try {
        const m = /^data:(image\/[a-zA-Z+]+);base64,([\s\S]+)$/.exec(String(data))
        const mime = m ? m[1] : 'image/png'
        const b64 = (m ? m[2] : String(data)).replace(/\s+/g, '')
        const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg')
        const name = `ai-img-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}.${ext}`
        fs.mkdirSync(imageDir, { recursive: true })
        fs.writeFileSync(path.join(imageDir, name), Buffer.from(b64, 'base64'))
        b.src = `/images/imported/${name}`
      } catch (err) {
        warnings.push(`图片写入失败：${err?.message || err}`)
      }
    }
    return warnings
  }

  const handle = async (req, res, pathname) => {
    const isLayoutApi = pathname === '/api/elements' || pathname === '/api/layout/validate'
    if (!pathname.startsWith('/api/format') && !isLayoutApi) return false
    const url = new URL(req.url, 'http://localhost')

    try {
      /* ---- 语义版面 JSON 直接排版（纯 Node，不开浏览器）---- */
      if (pathname === '/api/elements' && req.method === 'POST') {
        const buf = await readBody(req)
        let input
        try {
          input = JSON.parse(buf.toString('utf8'))
        } catch {
          json(res, 400, { ok: false, error: 'body 不是合法 JSON' })
          return true
        }
        const { layout, warnings } = normalizeLayout(input)
        if (!layout) {
          json(res, 400, { ok: false, errors: warnings })
          return true
        }
        const ori = url.searchParams.get('orientation')
        if (ori === 'portrait' || ori === 'landscape') layout.orientation = ori

        const imgWarnings = saveInlineImages(layout)
        const { doc, report } = buildDoc(layout)
        const push = url.searchParams.get('push') !== '0'
        const raw = JSON.stringify(doc)
        const saved = persist?.writeDoc ? persist.writeDoc(raw, push) : false
        log(`语义排版：${report.pages} 页 / ${report.elements} 组件 / ${report.chars} 字（${layout.blocks.length} 块）`)
        json(res, 200, {
          ok: true,
          pages: report.pages,
          elements: report.elements,
          chars: report.chars,
          report,
          warnings: [...warnings, ...imgWarnings],
          saved,
        })
        return true
      }

      /* ---- 只校验语义 JSON（不生成版面）---- */
      if (pathname === '/api/layout/validate' && req.method === 'POST') {
        const buf = await readBody(req)
        let input
        try {
          input = JSON.parse(buf.toString('utf8'))
        } catch {
          json(res, 400, { ok: false, errors: ['body 不是合法 JSON'] })
          return true
        }
        const result = validateLayout(input)
        json(res, 200, result)
        return true
      }

      /* ---- 自检 ---- */
      if (pathname === '/api/format/health' && req.method === 'GET') {
        const exe = chromiumPath ?? (chromiumPath = await findChromium())
        json(res, 200, { ok: Boolean(exe), chromium: exe, persist: Boolean(persist) })
        return true
      }

      /* ---- 装配页取元素 ---- */
      if (pathname === '/api/format/payload' && req.method === 'GET') {
        const job = jobs.get(url.searchParams.get('job') || '')
        if (!job) {
          json(res, 404, { error: 'job 不存在或已过期' })
          return true
        }
        json(res, 200, job.payload)
        return true
      }

      /* ---- 装配页回传结果 ---- */
      if (pathname === '/api/format/result' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8'))
        const job = jobs.get(body.job)
        if (!job) {
          json(res, 404, { error: 'job 不存在' })
          return true
        }
        if (body.error) job.reject(new Error(String(body.error)))
        else job.resolve({ doc: body.doc, warnings: body.warnings ?? [] })
        json(res, 200, { ok: true })
        return true
      }

      /* ---- 上传并排版 ---- */
      if (pathname === '/api/format' && req.method === 'POST') {
        const buf = await readBody(req)
        if (!buf.length) {
          json(res, 400, { error: '空文件' })
          return true
        }
        const rawName = decodeURIComponent(req.headers['x-file-name'] || 'upload.docx')
        const ext = path.extname(rawName).toLowerCase() || '.docx'
        const orientation = url.searchParams.get('orientation') === 'portrait' ? 'portrait' : 'landscape'
        const overrides = {}
        for (const k of ['journal', 'issue', 'date', 'editor', 'proofreader', 'watermark']) {
          const v = url.searchParams.get(k)
          if (v) overrides[k] = v
        }

        const jobId = randomUUID()
        const tmp = path.join(os.tmpdir(), `paiban-up-${jobId}${ext}`)
        await fsp.writeFile(tmp, buf)

        let blocks
        try {
          blocks = TEXT_EXT.test(ext) ? plainBlocks(buf) : (await parseDocFile(tmp)).blocks
        } finally {
          fsp.unlink(tmp).catch(() => {})
        }
        if (!blocks?.length) {
          json(res, 422, { error: '没解析出任何段落，确认文件是 .doc/.docx/.txt/.md' })
          return true
        }

        // 图片：抽出来放到静态目录，payload 里用 URL 引用
        let images = []
        try {
          const extracted = extractDocImages(buf)
          if (extracted.length) {
            await fsp.mkdir(imageDir, { recursive: true })
            images = await Promise.all(
              extracted.map(async (img, i) => {
                const name = `doc-img-${jobId.slice(0, 8)}-${i + 1}.${img.mime.split('/')[1]}`
                await fsp.writeFile(path.join(imageDir, name), img.data)
                return { ...img, url: `/images/imported/${name}` }
              }),
            )
          }
        } catch (err) {
          log(`图片抽取失败（不影响正文）：${err?.message || err}`)
        }

        const built = buildElements(blocks, { images })
        const payload = {
          ok: true,
          elements: built.elements,
          masthead: built.masthead,
          header: built.header,
          footer: built.footer,
          warnings: built.warnings,
          paragraphs: blocks.length,
          mergeMode: 'merge',
        }

        jobs.set(jobId, { payload, at: Date.now(), resolve: () => {}, reject: () => {} })

        const task = async () => {
          const result = await runBrowser(jobId, orientation)
          jobs.delete(jobId)
          applyOverrides(result.doc, overrides)
          const raw = JSON.stringify(result.doc)
          const saved = persist?.writeDoc(raw, true) ?? false
          return {
            ok: true,
            pages: result.doc.pages.length,
            elements: result.doc.pages.reduce((n, p) => n + p.els.length, 0),
            warnings: result.warnings,
            saved,
            job: jobId,
          }
        }

        // 串行执行，避免并发起多个浏览器
        const chained = queue.then(task, task)
        queue = chained.catch(() => {})
        const out = await chained
        json(res, 200, out)
        return true
      }

      json(res, 404, { error: 'not found' })
      return true
    } catch (err) {
      log(`排版 API 失败 ${req.method} ${pathname}: ${err?.message || err}`)
      for (const [id, job] of jobs) {
        try {
          job.reject(err)
        } catch {
          /* 忽略 */
        }
        jobs.delete(id)
      }
      if (!res.headersSent) json(res, 500, { error: String(err?.message || err) })
      return true
    }
  }

  return { handle }
}
