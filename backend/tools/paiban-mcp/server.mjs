#!/usr/bin/env node
/**
 * 排版周刊项目 MCP（stdio）
 *
 * 作用：让任意支持 MCP 的 agent 直接操作这个前端项目：
 * - 打开编辑器 / 读状态 / 读控制台
 * - 截图 / 取 DOM 元素矩形 / 检查是否出界、重叠、消失
 * - 执行一段页面 JS（比如改文字、切横竖版）
 * - 清空本地存档 / 跑 Playwright 冒烟回归
 *
 * 启动：pnpm mcp   （或 node tools/paiban-mcp/server.mjs）
 * 说明：日志一律写 stderr，stdout 只走 JSON-RPC，避免污染协议。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
import {
  ARTIFACT_DIR,
  BASE,
  ROOT,
  closeBrowser,
  ensureServer,
  launchBrowser,
  openEditor,
  readState,
  resetEditor,
  screenshot,
  sleep,
  waitSettled,
} from '../browser-utils.mjs'
import { createHash } from 'node:crypto'
import { normalizeLayout, validateLayout } from '../layout/schema.mjs'
import { buildDoc } from '../layout/geometry.mjs'
import { imageToDataUrl, resolveLocalImages } from '../layout/local-image.mjs'
import { DEFAULT_BASE, postElements } from '../layout/index.mjs'

const SERVER_INFO = { name: 'paiban-mcp', version: '1.1.0' }

/** 多用户凭证：读 skill 的 config.json（users 数组），按名字匹配算 md5(name:secret) */
async function resolveCred(userName) {
  try {
    const cfgPath = process.env.PAIBAN_SKILL_CONFIG
      || '/Users/gongyi/.workbuddy/skills/paiban-word-to-json/config.json'
    const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8'))
    const users = (cfg.users || []).filter((u) => u.name && u.secret && u.secret !== 'REPLACE_ME')
    if (!users.length) return { error: 'config.json 的 users 还没填真实用户（name/secret）' }
    const u = userName ? users.find((x) => x.name === userName) : users.length === 1 ? users[0] : null
    if (!u) {
      return { error: `没找到用户「${userName}」。config.json 里有：${users.map((x) => x.name).join('、')}` }
    }
    const k = createHash('md5').update(`${u.name}:${u.secret}`).digest('hex')
    return { cred: { u: u.name, k } }
  } catch (err) {
    return { error: `读 skill config.json 失败：${err?.message || err}` }
  }
}
const PROTOCOL_VERSION = '2024-11-05'

let rpcBuffer = ''
let controller = null

/** 给页面挂日志采集：控制台、pageerror、请求失败、4xx/5xx */
function attachLogs(page, logs) {
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push({ type: m.type(), text: m.text(), at: Date.now() })
  })
  page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: e.stack || String(e), at: Date.now() }))
  page.on('requestfailed', (r) =>
    logs.push({ type: 'requestfailed', text: `${r.url()} · ${r.failure()?.errorText ?? 'failed'}`, at: Date.now() }),
  )
  page.on('response', (r) => {
    if (r.status() >= 400) logs.push({ type: 'http', text: `${r.status()} ${r.url()}`, at: Date.now() })
  })
  return logs
}

class Editor {
  constructor() {
    this.page = null
    this.logs = []
    this.server = null
    this.attached = false
    this.viaCdp = false
  }

  /**
   * 两种接入方式：
   * - PAIBAN_CDP=http://127.0.0.1:9222 → 接管你已打开的 Chrome（不清存档、不重载）
   * - 否则自己起一个 Chromium，打开 PAIBAN_URL（会清存档，得到干净初始版面）
   */
  async ensure() {
    if (this.page && !this.page.isClosed()) return
    this.logs = []

    const cdp = process.env.PAIBAN_CDP
    if (cdp) {
      const browser = await chromium.connectOverCDP(cdp)
      const ctx = browser.contexts()[0] ?? (await browser.newContext())
      const url = BASE
      this.page =
        ctx.pages().find((p) => p.url().startsWith(url.replace(/\/$/, ''))) ??
        ctx.pages().find((p) => p.url().includes('127.0.0.1:517')) ??
        (await ctx.newPage())
      this.viaCdp = true
      attachLogs(this.page, this.logs)
      if (!this.page.url().startsWith('http')) await this.page.goto(url, { waitUntil: 'domcontentloaded' })
      await this.page.waitForFunction(() => !!window.__paibanApi, null, { timeout: 15000 })
      await waitSettled(this.page)
      return
    }

    this.server = await ensureServer()
    const { browser } = await launchBrowser()
    const opened = await openEditor(browser)
    this.page = opened.page
    this.logs = opened.logs
    this.attached = true
  }

  async reset() {
    await this.ensure()
    if (this.viaCdp) {
      // 接管真实浏览器时不动用户存档，只重新加载页面
      await this.page.reload({ waitUntil: 'domcontentloaded' })
      await this.page.waitForFunction(() => !!window.__paibanApi, null, { timeout: 15000 })
      await waitSettled(this.page)
      return
    }
    await resetEditor(this.page)
    await this.page.setViewportSize({ width: 1600, height: 1000 })
  }

  async state() {
    await this.ensure()
    return readState(this.page)
  }

  async runExpression(expression) {
    await this.ensure()
    if (typeof expression !== 'string' || !expression.trim()) throw new Error('expression 不能为空')
    return this.page.evaluate((code) => {
      // 在页面上下文执行；支持返回 Promise
      // eslint-disable-next-line no-new-func
      const fn = new Function('api', `return (async () => { ${code} })()`)
      return fn(window.__paibanApi)
    }, expression)
  }

  /** 把某一页滚动到可视区（截图用） */
  async scrollToPage(idx) {
    await this.page.evaluate((i) => {
      const node = document.querySelectorAll('.ed-page')[i]
      if (!node) return
      const wrap = node.closest('.ed-page-wrap')
      const scroller = document.querySelector('.ed-canvas-scroll')
      if (wrap && scroller) {
        scroller.scrollTop = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 10
      }
    }, idx)
    await sleep(220)
  }

  /** 等图片解码 + 字体就绪，否则截出来是破图/回退字体 */
  async waitImages() {
    try {
      await this.page.evaluate(async () => {
        const imgs = [...document.querySelectorAll('.ed-page img')]
        await Promise.all(
          imgs.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise((r) => {
                  img.addEventListener('load', r, { once: true })
                  img.addEventListener('error', r, { once: true })
                  setTimeout(r, 4000)
                }),
          ),
        )
        if (document.fonts?.ready) await document.fonts.ready
      })
    } catch {
      /* 忽略：等待失败不影响截图 */
    }
  }
}

function editor() {
  if (!controller) controller = new Editor()
  return controller
}

/* ------------------------------------------------------------------ *
 * 工具定义
 * ------------------------------------------------------------------ */

const EMPTY = { type: 'object', properties: {}, additionalProperties: false }

const TOOLS = [
  {
    name: 'paiban_status',
    description: '打开编辑器并返回文档状态：页数、元素数、横竖版、每页内容底部、页脚页码，以及是否出界/重叠/消失。',
    inputSchema: EMPTY,
  },
  {
    name: 'paiban_dom',
    description: '返回编辑器 DOM 完整性检查：doc 元素是否都在 DOM、是否有 0 尺寸元素、元素矩形列表（可选）。',
    inputSchema: {
      type: 'object',
      properties: {
        rects: { type: 'boolean', description: '是否附带每个元素的 x/y/w/h/z' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'paiban_console',
    description: '读取浏览器控制台错误/警告与 pageerror；可清空。',
    inputSchema: {
      type: 'object',
      properties: { clear: { type: 'boolean', description: '读取后是否清空' } },
      additionalProperties: false,
    },
  },
  {
    name: 'paiban_screenshot',
    description: '对当前页面截图，返回图片内容和本地文件路径。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '截图文件名（默认 shot-时间戳.png）' },
        fullPage: { type: 'boolean', description: '是否整页截图（默认 false）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'paiban_pages_shot',
    description: '逐页截图（自动滚动到每一页），保存到 artifacts/smoke/pages-N.png 并返回路径列表，方便和成品 PDF 逐页对比。',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: { type: 'string', description: '文件名前缀（默认 pages）' },
        max: { type: 'number', description: '最多截几页（默认 8）' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'paiban_import_word',
    description:
      '导入本机 Word 原稿：读文件 → 走 /@doc-import 解析 → 在页面生成版面（可 Ctrl+Z 撤销）。返回页数、组件数、警告；orientation 选导入成横版还是竖版，merge 控制短条目（学习要求/必考能力/易错项）合并还是拆分。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '原稿绝对路径（.doc / .docx / .rtf）' },
        orientation: {
          type: 'string',
          enum: ['landscape', 'portrait'],
          description: '目标版式：landscape A4 横版（默认）；portrait A4 竖版，直接按竖版栏宽装栏',
        },
        merge: {
          type: 'string',
          enum: ['auto', 'merge', 'split'],
          description: '短条目处理：auto 取页数最少且不被分页切断的方案（默认）；merge 整组一个组件；split 逐条独立',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'paiban_eval',
    description: '在编辑器页面上下文执行 JS，可直接使用变量 api（window.__paibanApi）。支持 await，return 的值会作为结果返回。',
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '要执行的 JS 代码，例如 return api.doc.pages.length' },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
  {
    name: 'paiban_orientation',
    description: '切换 A4 横版 / 竖版，并等待自动重排稳定。',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string', enum: ['portrait', 'landscape'] } },
      required: ['value'],
      additionalProperties: false,
    },
  },
  {
    name: 'paiban_reset',
    description: '清空 localStorage 中的版面存档并重新加载，回到初始模板。',
    inputSchema: EMPTY,
  },
  {
    name: 'paiban_print_check',
    description: '切换到打印媒体，检查工具栏是否隐藏、纸张尺寸和 @page 是否正确，然后恢复屏幕媒体。',
    inputSchema: EMPTY,
  },
  {
    name: 'paiban_run_smoke',
    description: '执行项目内置 Playwright 冒烟回归（约 20 秒），返回通过/失败摘要。',
    inputSchema: EMPTY,
  },

  /* —— 语义版面（不依赖浏览器，直接排版）—— */
  {
    name: 'validate_layout',
    description:
      '校验「语义版面 JSON」：检查块类型白名单、必填字段、内容是否为空，返回错误/提醒和块统计（含汉字数）。不生成版面、不需要浏览器，写完稿先跑这个。' +
      '语义 JSON 只需要 meta + blocks[]，不要写坐标。',
    inputSchema: {
      type: 'object',
      properties: {
        layout: { type: ['object', 'string'], description: '语义 JSON 对象，或 JSON 字符串' },
        path: { type: 'string', description: '或者给一个本地 .json 文件路径' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'submit_layout',
    description:
      '把语义版面 JSON 排成报纸并推送：默认 POST 到线上服务器 /api/elements，前端刷新即可看到（会先自动存一份快照）。' +
      '返回页数、组件数、每页两栏填充率。dryRun=true 只本地排版返回报告，不推送。',
    inputSchema: {
      type: 'object',
      properties: {
        layout: { type: ['object', 'string'], description: '语义 JSON 对象或 JSON 字符串' },
        path: { type: 'string', description: '或者给本地 .json 路径' },
        base: { type: 'string', description: `服务器地址，默认 ${DEFAULT_BASE}` },
        user: { type: 'string', description: '多用户：推送目标用户名（须在 skill config.json 的 users 里）。只有一个用户时可省略' },
        orientation: { type: 'string', enum: ['landscape', 'portrait'], description: '覆盖纸张方向' },
        dryRun: { type: 'boolean', description: '只排版不推送' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'upload_image',
    description:
      '读取本机图片，返回宽高比和可直接用于 image 块的 src（local: 开头）。submit_layout 会自动把它转成图片数据上传并在服务器落盘，不需要手动传文件。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '本机图片路径（png/jpg/gif/webp/bmp）' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
]

/* ------------------------------------------------------------------ *
 * 语义版面工具（纯 Node / 纯 HTTP，不起浏览器）
 * ------------------------------------------------------------------ */

/** 从参数里取语义 JSON：对象 / JSON 字符串 / 文件路径都行 */
async function readLayoutArg(args) {
  const fromFile = async (p) => fs.readFile(path.resolve(String(p).replace(/^~/, process.env.HOME ?? '')), 'utf8')
  if (args.layout !== undefined && args.layout !== null) {
    if (typeof args.layout === 'string') {
      const s = args.layout.trim()
      return s.startsWith('{') || s.startsWith('[') ? JSON.parse(s) : fromFile(s)
    }
    return args.layout
  }
  if (args.path) return fromFile(args.path)
  throw new Error('需要 layout（语义 JSON 对象 / JSON 字符串）或 path（本地 .json 路径）')
}

async function layoutTool(name, args = {}) {
  if (name === 'validate_layout') {
    const input = await readLayoutArg(args)
    return { text: JSON.stringify(validateLayout(input), null, 2) }
  }

  if (name === 'upload_image') {
    if (!args.path) throw new Error('upload_image 需要 path（本机图片路径）')
    const img = imageToDataUrl(args.path)
    // dataUrl 有几 MB，不回传给模型，只告诉它怎么引用
    const { dataUrl, ...rest } = img
    return {
      text: JSON.stringify(
        {
          ...rest,
          usage: { type: 'image', src: rest.src, ratio: rest.ratio },
          hint: 'src 用上面这个 local: 路径，submit_layout 会自动读文件并上传；不用把图片内容贴进 JSON。',
        },
        null,
        2,
      ),
    }
  }

  if (name === 'submit_layout') {
    const input = await readLayoutArg(args)
    const { layout, warnings } = normalizeLayout(input)
    if (!layout) return { text: JSON.stringify({ ok: false, errors: warnings }, null, 2) }
    if (args.orientation === 'portrait' || args.orientation === 'landscape') layout.orientation = args.orientation

    // 本机图片 → dataUrl（服务端落盘后改写 src）
    const img = resolveLocalImages(layout)
    const allWarnings = [...warnings, ...img.warnings]

    if (args.dryRun) {
      const { report } = buildDoc(layout)
      return {
        text: JSON.stringify({ ok: true, dryRun: true, images: img.resolved, report, warnings: allWarnings }, null, 2),
      }
    }

    const base = String(args.base || process.env.PAIBAN_BASE || DEFAULT_BASE).replace(/\/$/, '')
    const credRes = await resolveCred(args.user ?? process.env.PAIBAN_USER)
    if (credRes.error) {
      return { text: JSON.stringify({ ok: false, error: credRes.error }, null, 2) }
    }
    try {
      const res = await postElements(base, layout, 30000, credRes.cred)
      const body = res.json ?? { raw: String(res.text).slice(0, 400) }
      return {
        text: JSON.stringify(
          {
            ok: res.ok,
            status: res.status,
            base,
            images: img.resolved,
            warnings: allWarnings,
            result: body,
            hint: res.ok
              ? '已推送到服务器：刷新网页（或等自动载入）就能看到，再手工微调即可。'
              : res.status === 401
                ? '推送被拒（401）：用户名或密钥不对。检查 skill config.json 的 users 与服务器 users 表是否一致。'
                : '推送失败，检查服务器地址与 /api/elements 是否存在。',
          },
          null,
          2,
        ),
      }
    } catch (err) {
      return {
        text: JSON.stringify(
          {
            ok: false,
            base,
            error: String(err?.message || err),
            hint: '连不上服务器。可以先用 dryRun=true 在本地排版看报告，或把 base 指向自建服务器。',
          },
          null,
          2,
        ),
      }
    }
  }

  throw new Error(`未知工具 ${name}`)
}

/* ------------------------------------------------------------------ *
 * 工具实现
 * ------------------------------------------------------------------ */

async function toolResult(name, args = {}) {
  if (name === 'validate_layout' || name === 'submit_layout' || name === 'upload_image') {
    return await layoutTool(name, args)
  }
  const ed = editor()
  switch (name) {
    case 'paiban_status': {
      const s = await ed.state()
      return {
        text: JSON.stringify(
          {
            pages: s.pages,
            total: s.total,
            domCount: s.domCount,
            orientation: s.orientation,
            size: `${s.w} × ${s.h}`,
            pageIdx: s.pageIdx,
            missingInDom: s.missingInDom.length,
            invisible: s.invisible,
            outside: s.outside.length,
            overlaps: s.overlaps.length,
            overflowing: s.overflowing.length,
            footerLabels: s.footerLabels,
            pageStats: s.pageStats,
          },
          null,
          2,
        ),
      }
    }

    case 'paiban_dom': {
      const s = await ed.state()
      const data = {
        pages: s.pages,
        total: s.total,
        domCount: s.domCount,
        missingInDom: s.missingInDom,
        invisible: s.invisible,
        outside: s.outside,
        overlaps: s.overlaps.slice(0, 30),
        overlapCount: s.overlaps.length,
        overflowing: s.overflowing,
      }
      if (args.rects) {
        data.rects = await ed.page.evaluate(() =>
          window.__paibanApi.doc.pages.map((p, pi) =>
            p.els.map((e) => ({ pi, id: e.id, kind: e.kind, v: e.variant, x: e.x, y: e.y, w: e.w, h: e.h, z: e.z })),
          ),
        )
      }
      return { text: JSON.stringify(data, null, 2) }
    }

    case 'paiban_console': {
      await ed.ensure()
      const logs = ed.logs.slice()
      if (args.clear) ed.logs.length = 0
      return {
        text: JSON.stringify(
          {
            count: logs.length,
            pageerrors: logs.filter((l) => l.type === 'pageerror').length,
            entries: logs.slice(-80),
          },
          null,
          2,
        ),
      }
    }

    case 'paiban_screenshot': {
      await ed.ensure()
      const name = args.name || `shot-${Date.now()}.png`
      await fs.mkdir(ARTIFACT_DIR, { recursive: true })
      const file = path.join(ARTIFACT_DIR, name.endsWith('.png') ? name : `${name}.png`)
      await ed.page.screenshot({ path: file, fullPage: !!args.fullPage })
      const data = (await fs.readFile(file)).toString('base64')
      return {
        text: `截图已保存：${path.relative(ROOT, file)}`,
        images: [{ type: 'image', data, mimeType: 'image/png' }],
      }
    }

    case 'paiban_pages_shot': {
      await ed.ensure()
      const s = await ed.state()
      const prefix = (args.prefix || 'pages').replace(/[^\w.-]/g, '')
      const max = Math.min(Math.max(1, Number(args.max) || 8), 20)
      await fs.mkdir(ARTIFACT_DIR, { recursive: true })
      await ed.waitImages()
      const files = []
      const images = []
      for (let i = 0; i < Math.min(s.pages, max); i++) {
        await ed.scrollToPage(i)
        const file = path.join(ARTIFACT_DIR, `${prefix}-${i + 1}.png`)
        await ed.page.screenshot({ path: file })
        files.push(path.relative(ROOT, file))
        // 只内联第 1 页，避免一次返回几十 MB
        if (i === 0) images.push({ type: 'image', data: (await fs.readFile(file)).toString('base64'), mimeType: 'image/png' })
      }
      return { text: `共 ${s.pages} 页，截图：\n${files.join('\n')}`, images }
    }

    case 'paiban_import_word': {
      await ed.ensure()
      if (!args.path) throw new Error('path 不能为空')
      const abs = path.resolve(String(args.path).replace(/^~/, process.env.HOME || ''))
      const buf = await fs.readFile(abs)
      const endpoint = new URL('/@doc-import', BASE.endsWith('/') ? BASE : `${BASE}/`)
      const res = await fetch(endpoint, { method: 'POST', body: buf, headers: { 'Content-Type': 'application/octet-stream' } })
      const payload = await res.json().catch(() => null)
      if (!payload || !payload.ok) throw new Error(payload?.error || `解析失败（HTTP ${res.status}）`)

      const result = await ed.page.evaluate(
        async ([p, merge, orientation]) => {
          const fn = window.__paibanImport
          if (typeof fn !== 'function') throw new Error('页面没有暴露 __paibanImport，请刷新编辑器后再试')
          const built = await fn(p, { merge, orientation })
          window.__paibanApi.importDoc(built.doc)
          return {
            pageCount: built.pageCount,
            elements: built.doc.pages.reduce((n, pg) => n + pg.els.length, 0),
            warnings: built.warnings,
            paragraphs: p.paragraphs,
            merge: built.merge,
            profile: built.profile,
            groups: built.groups,
            orientation: built.orientation,
          }
        },
        [payload, args.merge ?? 'auto', args.orientation === 'portrait' ? 'portrait' : 'landscape'],
      )
      await waitSettled(ed.page)
      await ed.waitImages()
      const after = await ed.state()
      return {
        text: JSON.stringify(
          {
            ok: true,
            file: path.basename(abs),
            elapsedMs: payload.elapsed,
            paragraphs: result.paragraphs,
            components: payload.elements.length,
            docElements: result.elements,
            mergeMode: result.merge,
            packProfile: result.profile,
            orientation: result.orientation,
            mergeGroups: result.groups,
            pages: after.pages,
            pageCountFromBuild: result.pageCount,
            images: (payload.images || []).length,
            warnings: result.warnings,
            invariants: {
              outside: after.outside.length,
              overlaps: after.overlaps.length,
              overflowing: after.overflowing.length,
              furnitureOverlaps: after.furnitureOverlaps.length,
              contentOverflow: after.contentOverflow.length,
            },
          },
          null,
          2,
        ),
      }
    }

    case 'paiban_eval': {
      const value = await ed.runExpression(args.expression)
      return { text: JSON.stringify({ ok: true, value: value ?? null }, null, 2) }
    }

    case 'paiban_orientation': {
      await ed.ensure()
      const value = args.value === 'portrait' ? 'portrait' : 'landscape'
      await ed.page.evaluate((v) => window.__paibanApi.setOrientation(v), value)
      await waitSettled(ed.page, 8000)
      const s = await ed.state()
      return { text: JSON.stringify({ ok: true, orientation: s.orientation, size: `${s.w} × ${s.h}`, pages: s.pages, total: s.total, outside: s.outside.length, overlaps: s.overlaps.length, overflowing: s.overflowing.length }, null, 2) }
    }

    case 'paiban_reset': {
      await ed.reset()
      const s = await ed.state()
      return { text: JSON.stringify({ ok: true, pages: s.pages, total: s.total, orientation: s.orientation }, null, 2) }
    }

    case 'paiban_print_check': {
      await ed.ensure()
      await ed.page.emulateMedia({ media: 'print' })
      await sleep(200)
      const result = await ed.page.evaluate(() => {
        const bar = document.querySelector('.ed-toolbar')
        const pageEl = document.querySelector('.ed-page')
        const r = pageEl.getBoundingClientRect()
        const styles = [...document.querySelectorAll('style')].map((s) => s.textContent || '')
        return {
          toolbarDisplay: bar ? getComputedStyle(bar).display : 'missing',
          pageWidth: r.width,
          pageHeight: r.height,
          expectedWidth: window.__paibanApi.doc.w,
          expectedHeight: window.__paibanApi.doc.h,
          hasMatchingAtPage: styles.some((s) => s.includes('@page') && s.includes(`${window.__paibanApi.doc.w}px`)),
        }
      })
      await ed.page.emulateMedia({ media: 'screen' })
      return { text: JSON.stringify(result, null, 2) }
    }

    case 'paiban_run_smoke': {
      const output = await new Promise((resolve) => {
        const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'smoke.mjs')], {
          cwd: ROOT,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let out = ''
        const timer = setTimeout(() => {
          proc.kill('SIGTERM')
          out += '\n[timeout] 冒烟测试超过 120 秒，已终止'
        }, 120_000)
        proc.stdout.on('data', (d) => (out += d.toString()))
        proc.stderr.on('data', (d) => (out += d.toString()))
        proc.on('close', (code) => {
          clearTimeout(timer)
          resolve({ code, out })
        })
      })
      const tail = output.out.length > 12000 ? output.out.slice(-12000) : output.out
      return { text: `exit=${output.code}\n${tail}` }
    }

    default:
      throw new Error(`未知工具：${name}`)
  }
}

/* ------------------------------------------------------------------ *
 * JSON-RPC / MCP
 * ------------------------------------------------------------------ */

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return
  const { id, method, params } = msg
  const isNotification = id === undefined || id === null

  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        '排版周刊编辑器 MCP。要把稿子排成周刊：先 validate_layout 校验语义 JSON，再 submit_layout 推送（纯 Node + HTTP，不起浏览器）。' +
        '要检查或调试页面：paiban_status → paiban_dom → paiban_console，paiban_eval 可直接操作 window.__paibanApi。',
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'initialized') return
  if (method === 'ping') {
    if (!isNotification) sendResult(id, {})
    return
  }
  if (method === 'tools/list') {
    sendResult(id, { tools: TOOLS })
    return
  }
  if (method === 'tools/call') {
    const name = params?.name
    const args = params?.arguments ?? {}
    try {
      const res = await toolResult(name, args)
      const content = [{ type: 'text', text: res.text }]
      if (res.images) content.push(...res.images)
      sendResult(id, { content, isError: false })
    } catch (err) {
      sendResult(id, {
        content: [{ type: 'text', text: `工具 ${name} 执行失败：${err.stack || err.message}` }],
        isError: true,
      })
    }
    return
  }
  if (method === 'shutdown') {
    if (!isNotification) sendResult(id, {})
    await cleanup()
    setTimeout(() => process.exit(0), 20)
    return
  }
  if (method === 'exit') {
    await cleanup()
    process.exit(0)
  }
  if (!isNotification) sendError(id, -32601, `Method not found: ${method}`)
}

async function cleanup() {
  try {
    await closeBrowser()
  } catch {
    /* 忽略 */
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  rpcBuffer += chunk
  let idx
  while ((idx = rpcBuffer.indexOf('\n')) >= 0) {
    const line = rpcBuffer.slice(0, idx).trim()
    rpcBuffer = rpcBuffer.slice(idx + 1)
    if (!line) continue
    let msg
    try {
      msg = JSON.parse(line)
    } catch (err) {
      sendError(null, -32700, `Parse error: ${err.message}`)
      continue
    }
    handle(msg).catch((err) => {
      console.error('[paiban-mcp] handle error', err)
      if (msg && msg.id) {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(err.stack || err.message) } })
      }
    })
  }
})

process.stdin.on('end', async () => {
  await cleanup()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await cleanup()
  process.exit(0)
})
process.on('SIGTERM', async () => {
  await cleanup()
  process.exit(0)
})

console.error(`[paiban-mcp] ready · ${TOOLS.length} tools · ${ROOT}`)
