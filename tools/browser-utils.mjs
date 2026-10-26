/**
 * 浏览器回归 / MCP 共用工具
 * - 自动复用或启动 Vite dev server
 * - 自动查找本机 Playwright 缓存的 Chromium（无需再下载）
 */
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BASE = process.env.PAIBAN_URL ?? 'http://127.0.0.1:5173/'
export const ARTIFACT_DIR = path.join(ROOT, 'artifacts', 'smoke')

let serverPromise = null
let browserPromise = null

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function reachable(url, timeout = 1200) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    return res.ok
  } catch {
    return false
  }
}

export async function ensureServer() {
  if (await reachable(BASE)) return { started: false, url: BASE }
  if (serverPromise) return serverPromise
  serverPromise = (async () => {
    const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
    if (!fsSync.existsSync(vite)) throw new Error('找不到 vite，请先执行 pnpm install')
    const proc = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', '5173'], {
      cwd: ROOT,
      stdio: 'ignore',
      detached: false,
    })
    proc.on('exit', () => {
      serverPromise = null
    })
    for (let i = 0; i < 80; i++) {
      if (await reachable(BASE, 500)) return { started: true, url: BASE, proc }
      await sleep(250)
    }
    throw new Error('Vite dev server 启动超时（http://127.0.0.1:5173）')
  })()
  return serverPromise
}

export async function findChromium() {
  const env = process.env.PAIBAN_CHROMIUM || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  if (env && fsSync.existsSync(env)) return env

  const cacheRoot = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
  const linuxRoot = path.join(os.homedir(), '.cache', 'ms-playwright')
  const roots = [cacheRoot, linuxRoot]
  const candidates = []
  for (const root of roots) {
    let dirs = []
    try {
      dirs = await fs.readdir(root)
    } catch {
      continue
    }
    dirs
      .filter((d) => d.startsWith('chromium-'))
      .sort()
      .reverse()
      .forEach((d) => {
        candidates.push(
          path.join(root, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
          path.join(root, d, 'chrome-mac', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
          path.join(root, d, 'chrome-linux', 'chrome'),
          path.join(root, d, 'chrome-win', 'chrome.exe'),
        )
      })
  }
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c
  }
  return undefined
}

export async function launchBrowser() {
  if (browserPromise) return browserPromise
  browserPromise = (async () => {
    const executablePath = await findChromium()
    let browser
    if (executablePath) {
      browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] })
    } else {
      try {
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
      } catch (err) {
        throw new Error(
          `没有找到可用的 Chromium。请执行 "pnpm exec playwright-core install chromium"，或设置 PAIBAN_CHROMIUM 指向 Chrome 可执行文件。原始错误：${err.message}`,
        )
      }
    }
    return { browser, executablePath }
  })()
  return browserPromise
}

export async function closeBrowser() {
  if (!browserPromise) return
  try {
    const { browser } = await browserPromise
    await browser.close()
  } catch {
    /* 忽略 */
  }
  browserPromise = null
}

export async function openEditor(browser, { viewport = { width: 1600, height: 1000 } } = {}) {
  const page = await browser.newPage({ viewport })
  const logs = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push({ type: m.type(), text: m.text(), at: Date.now() })
  })
  page.on('pageerror', (e) => logs.push({ type: 'pageerror', text: e.stack || String(e), at: Date.now() }))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('paiban-editor-doc-v1'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__paibanApi)
  await waitSettled(page)
  await scrollToTop(page)
  return { page, logs }
}

export async function resetEditor(page) {
  await page.evaluate(() => localStorage.removeItem('paiban-editor-doc-v1'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__paibanApi)
  await waitSettled(page)
  await scrollToTop(page)
}

export async function scrollToTop(page) {
  await page.evaluate(() => {
    const el = document.querySelector('.ed-canvas-scroll')
    if (el) el.scrollTop = 0
  })
}

/** 等待自动高度 / 分页稳定（连续两帧 DOM 状态一致） */
export async function waitSettled(page, timeout = 12000) {
  const started = Date.now()
  let prev = ''
  let stable = 0
  while (Date.now() - started < timeout) {
    const sig = await page
      .evaluate(() => {
        const api = window.__paibanApi
        if (!api) return 'no-api'
        return JSON.stringify(
          api.doc.pages.map((p) =>
            p.els.map((e) => [e.id, Math.round(e.x * 10) / 10, Math.round(e.y * 10) / 10, Math.round(e.w * 10) / 10, Math.round(e.h * 10) / 10]),
          ),
        )
      })
      .catch(() => 'err')
    if (sig === prev) stable++
    else {
      prev = sig
      stable = 0
    }
    if (stable >= 3) return
    await sleep(150)
  }
}

/** 等页面里的图片解码完成、字体就绪，否则截图会拍到空白/破图 */
export async function waitImages(page, timeout = 4000) {
  try {
    await page.evaluate(async (ms) => {
      const imgs = [...document.querySelectorAll('.ed-page img')]
      await Promise.all(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((r) => {
                img.addEventListener('load', r, { once: true })
                img.addEventListener('error', r, { once: true })
                setTimeout(r, ms)
              }),
        ),
      )
      if (document.fonts?.ready) await document.fonts.ready
    }, timeout)
    // 再等解码落一帧
    await sleep(120)
  } catch {
    /* 忽略：等待失败不影响截图 */
  }
}

export async function readState(page) {
  return page.evaluate(() => {
    const api = window.__paibanApi
    if (!api) throw new Error('window.__paibanApi 不存在，编辑器未挂载')
    const d = api.doc
    const FURN = new Set(['header', 'masthead', 'footer'])
    const isFlowable = (e) => !(e.kind === 'chrome' && FURN.has(e.variant)) && e.kind !== 'region' && !e.background
    const outside = []
    const overlaps = []
    const overflowing = []
    const furnitureOverlaps = []
    const contentOverflow = []
    const pageStats = []
    const flowIds = []

    d.pages.forEach((p, pi) => {
      const flow = p.els.filter(isFlowable)
      let bottom = 0
      for (const e of flow) {
        flowIds.push(e.id)
        bottom = Math.max(bottom, e.y + e.h)
        if (e.x < -1 || e.y < -1 || e.x + e.w > d.w + 1 || e.y + e.h > d.h + 1) {
          outside.push({ pi, id: e.id, v: e.variant, x: e.x, y: e.y, w: e.w, h: e.h })
        }
      }
      const footers = p.els.filter((e) => e.kind === 'chrome' && e.variant === 'footer')
      const headerBottom = Math.max(
        0,
        ...p.els.filter((e) => e.kind === 'chrome' && (e.variant === 'header' || e.variant === 'masthead')).map((e) => e.y + e.h),
      )
      const footerTop = footers.length ? Math.min(...footers.map((e) => e.y)) : d.h - 60.5
      const contentBottom = footerTop - 8
      if (bottom > contentBottom + 1) overflowing.push({ pi, bottom: Math.round(bottom), contentBottom: Math.round(contentBottom) })

      for (let i = 0; i < flow.length; i++) {
        for (let j = i + 1; j < flow.length; j++) {
          const a = flow[i]
          const b = flow[j]
          if (a.x < b.x + b.w - 0.5 && a.x + a.w > b.x + 0.5 && a.y < b.y + b.h - 0.5 && a.y + a.h > b.y + 0.5) {
            overlaps.push({ pi, a: a.id, b: b.id })
          }
        }
      }
      const furniture = p.els.filter((e) => e.kind === 'chrome' && FURN.has(e.variant))
      for (const f of furniture) {
        for (const e of flow) {
          if (f.x < e.x + e.w - 0.5 && f.x + f.w > e.x + 0.5 && f.y < e.y + e.h - 0.5 && f.y + f.h > e.y + 0.5) {
            furnitureOverlaps.push({ pi, furniture: f.id, variant: f.variant, content: e.id, fy: Math.round(f.y), fh: Math.round(f.h), cy: Math.round(e.y) })
          }
        }
      }
      pageStats.push({
        pi,
        els: p.els.length,
        flow: flow.length,
        bottom: Math.round(bottom * 10) / 10,
        contentBottom: Math.round(contentBottom * 10) / 10,
        headerBottom,
        footer: footers[0]?.html?.match(/\d+\s*\/\s*\d+/)?.[0] ?? null,
      })
    })

    const docIds = d.pages.flatMap((p) => p.els.map((e) => e.id))
    const nodes = [...document.querySelectorAll('.ed-el[data-el-id]')]
    const domIds = nodes.map((n) => n.dataset.elId)
    const missingInDom = docIds.filter((id) => !domIds.includes(id))
    const invisible = nodes.filter((n) => {
      const r = n.getBoundingClientRect()
      const cs = getComputedStyle(n)
      return r.width < 1 || r.height < 1 || cs.display === 'none' || cs.visibility === 'hidden'
    }).length
    nodes.forEach((n) => {
      const slot = n.querySelector('.ed-slot')
      if (!slot) return
      if (slot.scrollHeight > slot.clientHeight + 3) {
        contentOverflow.push({ id: n.dataset.elId, scrollH: slot.scrollHeight, clientH: slot.clientHeight })
      }
    })

    return {
      w: d.w,
      h: d.h,
      orientation: d.orientation,
      pages: d.pages.length,
      pageIdx: api.pageIdx,
      total: docIds.length,
      domCount: nodes.length,
      missingInDom,
      invisible,
      outside,
      overlaps,
      overflowing,
      furnitureOverlaps,
      contentOverflow,
      pageStats,
      footerLabels: pageStats.map((p) => p.footer),
    }
  })
}

export async function readMaxGap(page) {
  return page.evaluate(() => {
    const api = window.__paibanApi
    const d = api.doc
    const FURN = new Set(['header', 'masthead', 'footer'])
    let maxGap = 0
    d.pages.forEach((p) => {
      const flow = p.els.filter((e) => !(e.kind === 'chrome' && FURN.has(e.variant)) && e.kind !== 'region' && !e.background && !e.locked)
      const cols = { 0: [], 1: [] }
      flow.forEach((e) => {
        const col = e.x + e.w / 2 < d.w / 2 ? 0 : 1
        cols[col].push(e)
      })
      for (const arr of Object.values(cols)) {
        arr.sort((a, b) => a.y - b.y || a.x - b.x)
        for (let i = 1; i < arr.length; i++) {
          const a = arr[i - 1]
          const b = arr[i]
          if (a.x < b.x + b.w && a.x + a.w > b.x) maxGap = Math.max(maxGap, b.y - (a.y + a.h))
        }
      }
    })
    return Math.round(maxGap * 10) / 10
  })
}

export async function pageRect(page, pageIdx = 0) {
  return page.evaluate((idx) => {
    const api = window.__paibanApi
    const node = document.querySelectorAll('.ed-page')[idx]
    const wrap = node.closest('.ed-page-wrap')
    const scroller = document.querySelector('.ed-canvas-scroll')
    if (wrap && scroller) {
      const top = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      scroller.scrollTop = Math.max(0, top - 18)
    }
    const r = node.getBoundingClientRect()
    const el = api.doc.pages[idx]
    return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, zoom: api.zoom, docW: api.doc.w, docH: api.doc.h, elCount: el?.els.length ?? 0 }
  }, pageIdx)
}

export async function findElementPage(page, id) {
  return page.evaluate((elId) => {
    const api = window.__paibanApi
    let found = 0
    api.doc.pages.forEach((p, i) => {
      if (p.els.some((e) => e.id === elId)) found = i
    })
    return found
  }, id)
}

export async function dragElement(page, id, { dy = 0, dx = 0, steps = 20, pointerY = null, pointerX = null, targetPage = null, targetRelX = 120, targetRelY = 120 } = {}) {
  const locator = page.locator(`.ed-el[data-el-id="${id}"]`).first()
  await locator.waitFor({ state: 'visible', timeout: 5000 })
  await locator.scrollIntoViewIfNeeded()
  await sleep(180)

  const meta = await page.evaluate((elId) => {
    const api = window.__paibanApi
    let pageIdx = 0
    api.doc.pages.forEach((p, i) => {
      if (p.els.some((e) => e.id === elId)) pageIdx = i
    })
    return { pageIdx, zoom: api.zoom }
  }, id)
  const rect = await pageRect(page, meta.pageIdx)
  await sleep(120)
  const box = await locator.boundingBox()
  if (!box) throw new Error(`元素 ${id} 没有可拖拽的边界框`)
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  const zoom = meta.zoom
  let endX = pointerX ?? startX + dx * zoom
  let endY = pointerY ?? startY + dy * zoom
  if (targetPage != null) {
    const tb = await page.evaluate((idx) => {
      const node = document.querySelectorAll('.ed-page')[idx]
      if (!node) return null
      const r = node.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }, targetPage)
    if (!tb) throw new Error(`目标页 ${targetPage} 不存在`)
    endX = tb.x + targetRelX
    endY = tb.y + targetRelY
  }
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + ((endX - startX) * i) / steps, startY + ((endY - startY) * i) / steps)
    await sleep(8)
  }
  await page.mouse.up()
  await waitSettled(page)
  return { ...meta, pageRect: rect, startX, startY, endX, endY }
}

export async function screenshot(page, name) {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true })
  const file = path.join(ARTIFACT_DIR, name.endsWith('.png') ? name : `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  return file
}

export function assert(cond, message) {
  if (!cond) throw new Error(message)
}

export function assertInvariants(state, label) {
  assert(state.missingInDom.length === 0, `${label}：有 ${state.missingInDom.length} 个元素不在 DOM 中（消失）`)
  assert(state.invisible === 0, `${label}：有 ${state.invisible} 个元素尺寸为 0 / 不可见`)
  assert(state.outside.length === 0, `${label}：有 ${state.outside.length} 个元素超出页面边界`)
  assert(state.overlaps.length === 0, `${label}：有 ${state.overlaps.length} 处元素重叠`)
  assert(state.overflowing.length === 0, `${label}：有内容超出页底未分页`)
  assert(state.furnitureOverlaps.length === 0, `${label}：页眉/报头/页脚与正文重叠 ${JSON.stringify(state.furnitureOverlaps.slice(0, 3))}`)
  assert(state.contentOverflow.length === 0, `${label}：组件框高度小于内容高度 ${JSON.stringify(state.contentOverflow.slice(0, 5))}`)
}
