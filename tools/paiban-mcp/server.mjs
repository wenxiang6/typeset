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
import {
  ARTIFACT_DIR,
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

const SERVER_INFO = { name: 'paiban-mcp', version: '1.0.0' }
const PROTOCOL_VERSION = '2024-11-05'

let rpcBuffer = ''
let controller = null

class Editor {
  constructor() {
    this.page = null
    this.logs = []
    this.server = null
  }

  async ensure() {
    if (this.page && !this.page.isClosed()) return
    this.server = await ensureServer()
    const { browser } = await launchBrowser()
    const opened = await openEditor(browser)
    this.page = opened.page
    this.logs = opened.logs
  }

  async reset() {
    await this.ensure()
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
]

/* ------------------------------------------------------------------ *
 * 工具实现
 * ------------------------------------------------------------------ */

async function toolResult(name, args = {}) {
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
        '排版周刊编辑器 MCP。先用 paiban_status 看状态，再用 paiban_dom / paiban_console 定位问题；paiban_eval 可直接操作 window.__paibanApi；改动后建议 paiban_run_smoke 回归。',
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
