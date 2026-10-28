#!/usr/bin/env node
/**
 * 验证版面 JSON：走网页版「导入 JSON」按钮载入，检查页数、越界、重叠、溢出。
 *
 *   node tools/import/verify-json.mjs 版面.json [--shots=dir]
 *
 * 用途：给服务器版导入前先自检。JSON 里的坐标是生成时算好的，
 * 换台机器字体不同会重新 reflow，这里就是把「导入后到底几页」跑一遍。
 */
import path from 'node:path'
import os from 'node:os'
import { mkdir } from 'node:fs/promises'
import { ensureServer, launchBrowser, closeBrowser, openEditor, waitSettled, sleep } from '../browser-utils.mjs'

const argv = process.argv.slice(2)
const file = argv.find((a) => !a.startsWith('-'))
if (!file) {
  console.error('用法: node tools/import/verify-json.mjs <版面.json> [--shots=dir]')
  process.exit(1)
}
const jsonPath = path.resolve(file.replace(/^~/, os.homedir()))
const shotDir = argv.find((a) => a.startsWith('--shots='))?.split('=')[1]

await ensureServer()
const { browser } = await launchBrowser()
const { page, logs } = await openEditor(browser)

await page.setInputFiles('input[accept="application/json"]', jsonPath)
await sleep(400)
await waitSettled(page)
await sleep(600)

const state = await page.evaluate(() => {
  const d = window.__paibanApi.doc
  const FURN = new Set(['header', 'masthead', 'footer'])
  const rows = []
  const bad = []
  d.pages.forEach((p, i) => {
    const body = p.els.filter((e) => !FURN.has(e.variant) && e.kind !== 'region' && !e.background)
    const bottom = body.length ? Math.max(...body.map((e) => e.y + e.h)) : 0
    rows.push({ 页: i + 1, 元素: body.length, 内容底部: Math.round(bottom), 余量: Math.round(733 - bottom) })
    for (const e of body) {
      if (e.x + e.w > d.w - 20 || e.y + e.h > d.h - 40) bad.push({ 页: i + 1, 组件: e.variant, x: Math.round(e.x), w: Math.round(e.w) })
    }
  })
  // 同栏重叠检测
  const overlaps = []
  d.pages.forEach((p, i) => {
    const body = p.els.filter((e) => !FURN.has(e.variant))
    for (let a = 0; a < body.length; a++)
      for (let b = a + 1; b < body.length; b++) {
        const A = body[a]
        const B = body[b]
        const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x)
        const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y)
        if (ox > 6 && oy > 6) overlaps.push({ 页: i + 1, a: A.variant, b: B.variant, 重叠: Math.round(Math.min(ox, oy)) })
      }
  })
  return { pages: d.pages.length, orientation: d.orientation, rows, bad, overlaps }
})

console.log(`\n导入后：${state.pages} 页 · ${state.orientation === 'portrait' ? '竖版' : '横版'}`)
console.table(state.rows)
console.log('越界:', state.bad.length, '| 同栏重叠:', state.overlaps.length)
if (state.bad.length) console.log(JSON.stringify(state.bad.slice(0, 6)))
if (state.overlaps.length) console.log(JSON.stringify(state.overlaps.slice(0, 6)))

if (shotDir) {
  await mkdir(path.resolve(shotDir), { recursive: true })
  for (let i = 0; i < state.pages; i++) {
    await page.evaluate((idx) => {
      const node = document.querySelectorAll('.ed-page')[idx]
      const wrap = node?.closest('.ed-page-wrap')
      const scroller = document.querySelector('.ed-canvas-scroll')
      if (wrap && scroller) scroller.scrollTop = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8
    }, i)
    await sleep(250)
    const f = path.resolve(shotDir, `check-p${i + 1}.png`)
    await page.locator('.ed-page').nth(i).screenshot({ path: f })
    console.log('· 截图', f)
  }
}

const errs = logs.filter((l) => l.type === 'pageerror')
if (errs.length) console.log('运行期错误:\n' + errs.map((e) => e.text).join('\n'))
await closeBrowser()
