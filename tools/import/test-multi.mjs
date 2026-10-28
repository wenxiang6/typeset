#!/usr/bin/env node
/**
 * 多选 + 多块合并的端到端验证（走真实鼠标，不走 api 直调）。
 *
 *   node tools/import/test-multi.mjs [var/issue1/out2.json]
 *
 * 验证四件事：
 *   1. 点选 → 单选；Shift 点第二个 → 选 2 块；
 *   2. 右键已选中的块 → 菜单保留多选 → 「合并为一块」→ 元素 -1、汉字不丢；
 *   3. 均分成 3 块（count 模式）→ 块数 = 3、汉字不丢；
 *   4. 空白处拖动框选 → 一次选中多块。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ensureServer, launchBrowser, openEditor, closeBrowser, sleep, screenshot, waitSettled, pageRect } from '../browser-utils.mjs'

const src = process.argv[2] ?? 'var/issue1/out2.json'
const raw = fs.readFileSync(path.resolve(src), 'utf8')
JSON.parse(raw)

await ensureServer()
const { browser } = await launchBrowser()
const { page } = await openEditor(browser, { viewport: { width: 1600, height: 1000 } })
const base = page.url()
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message || e)))

await page.addInitScript(
  ({ docKey, docRaw }) => {
    try {
      localStorage.setItem(docKey, docRaw)
      for (const k of Object.keys(localStorage)) if (k.startsWith('paiban-push-seen')) localStorage.removeItem(k)
    } catch {
      /* 忽略 */
    }
  },
  { docKey: 'paiban-editor-doc-v1', docRaw: raw },
)
await page.goto(base, { waitUntil: 'load' })
await page.waitForFunction(() => !!window.__paibanApi, null, { timeout: 20000 })
await sleep(1200)
await pageRect(page, 0)
await sleep(300)

const cn = (t) => (String(t ?? '').replace(/<[^>]+>/g, '').match(/[\u4e00-\u9fa5]/g) || []).length
const stats = () =>
  page.evaluate((cnsrc) => {
    const api = window.__paibanApi
    const cnFn = new Function(`return (${cnsrc})`)()
    const all = api.doc.pages.flatMap((p) => p.els.map((e) => e.html ?? '')).join('')
    return {
      pages: api.doc.pages.length,
      els: api.doc.pages.reduce((n, p) => n + p.els.length, 0),
      chars: cnFn(all),
      sel: api.selectedIds ?? [],
    }
  }, cn.toString())

// 找第一页上同 variant、且都在首屏可见的前两个文字块
const pick = await page.evaluate(() => {
  const api = window.__paibanApi
  const page0 = api.doc.pages[0]
  const cands = page0.els
    .filter((e) => e.html && (e.kind === 'text' || e.kind === 'box') && !e.locked && !e.background && e.kind !== 'region')
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const byVariant = new Map()
  for (const e of cands) {
    const arr = byVariant.get(e.variant) ?? []
    arr.push(e)
    byVariant.set(e.variant, arr)
  }
  for (const [variant, arr] of byVariant) {
    if (arr.length >= 2) return { variant, a: arr[0].id, b: arr[1].id, n: arr.length }
  }
  return null
})
if (!pick) {
  console.log('✗ 第一页没有同类型的两个块，无法测合并')
  await closeBrowser()
  process.exit(1)
}
console.log(`目标：第一页 ${pick.variant} 共 ${pick.n} 块，取前两块`)

const clickEl = async (id, modifiers = []) => {
  const loc = page.locator(`.ed-el[data-el-id="${id}"]`).first()
  await loc.scrollIntoViewIfNeeded()
  await sleep(120)
  const box = await loc.boundingBox()
  const x = box.x + Math.min(40, box.width / 2)
  const y = box.y + Math.min(14, box.height / 2)
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.up()
  for (const m of modifiers) await page.keyboard.up(m)
  await sleep(260)
  return { x, y }
}

const before = await stats()
console.log(`基线：页 ${before.pages} 元素 ${before.els} 汉字 ${before.chars}`)

// 1) 单选 + Shift 追加
await clickEl(pick.a)
const afterClick = await stats()
await clickEl(pick.b, ['Shift'])
const afterShift = await stats()
console.log(`点选后选中 ${afterClick.sel.length} 块；Shift 点第二块后 ${afterShift.sel.length} 块`)
const multiOk = afterClick.sel.length === 1 && afterShift.sel.length === 2
console.log(multiOk ? '✓ 单选 / Shift 连选正常' : '✗ 多选数量不对')

await screenshot(page, 'multi-selected')

// 2) 右键已选中的块 → 菜单应保留多选 → 点「合并为一块」
const locB = page.locator(`.ed-el[data-el-id="${pick.b}"]`).first()
const boxB = await locB.boundingBox()
await page.mouse.click(boxB.x + Math.min(40, boxB.width / 2), boxB.y + Math.min(14, boxB.height / 2), { button: 'right' })
await sleep(320)
const menuItems = await page.locator('.ed-ctxmenu .ed-ctxmenu-item').allTextContents()
const headText = await page.locator('.ed-ctxmenu .ed-ctxmenu-head').textContent().catch(() => null)
console.log(`右键菜单：${headText ? `标题「${headText}」` : '无标题'}，项：${menuItems.map((t) => t.trim()).join(' | ')}`)
const mergeItem = page.locator('.ed-ctxmenu .ed-ctxmenu-item', { hasText: '合并为一块' }).first()
const mergeVisible = await mergeItem.count()
if (mergeVisible) {
  await mergeItem.click()
  await sleep(900)
  await waitSettled(page)
}
const afterMerge = await stats()
console.log(`合并后：页 ${afterMerge.pages} 元素 ${afterMerge.els} 汉字 ${afterMerge.chars}，选中 ${afterMerge.sel.length} 块`)
const mergeOk = mergeVisible > 0 && afterMerge.els === before.els - 1 && afterMerge.chars === before.chars
console.log(
  mergeOk
    ? '✓ 多选合并：元素 -1、汉字零丢失'
    : `✗ 合并异常（元素 ${before.els}→${afterMerge.els}，汉字 ${before.chars}→${afterMerge.chars}，菜单项 ${mergeVisible}）`,
)

// 3) 均分成 3 块（count 模式）
const splitTarget = await page.evaluate(() => {
  const api = window.__paibanApi
  const cands = api.doc.pages
    .flatMap((p) => p.els)
    .filter((e) => e.html && (e.kind === 'text' || e.kind === 'box') && !e.locked)
    .map((e) => ({ id: e.id, html: e.html }))
    .sort((a, b) => (b.html.match(/<[a-zA-Z]/g) ?? []).length - (a.html.match(/<[a-zA-Z]/g) ?? []).length)
  return cands[0] ?? null
})
let countResult = null
if (splitTarget) {
  const beforeSplit = await stats()
  countResult = await page.evaluate(async (id) => {
    const api = window.__paibanApi
    const made = api.splitElement(id, 'count', { parts: 3 })
    await new Promise((r) => setTimeout(r, 800))
    const a = window.__paibanApi
    return { made, els: a.doc.pages.reduce((n, p) => n + p.els.length, 0), pages: a.doc.pages.length }
  }, splitTarget.id)
  await waitSettled(page)
  const afterSplit = await stats()
  console.log(
    `均分 3 块：made=${countResult.made}，元素 ${beforeSplit.els}→${afterSplit.els}，汉字 ${beforeSplit.chars}→${afterSplit.chars}，页 ${afterSplit.pages}`,
  )
  const ok = countResult.made === 3 && afterSplit.els === beforeSplit.els + 2 && afterSplit.chars === beforeSplit.chars
  console.log(ok ? '✓ 一块拆成 3 块，文字零丢失' : '✗ 均分 3 块结果不对')
}

// 4) 空白处框选（先找一个确实没有元素的空白点，再往右下拖）
await page.evaluate(() => {
  window.__paibanApi.setSelection(null)
  const sc = document.querySelector('.ed-canvas-scroll')
  if (sc) sc.scrollTop = 0
})
await sleep(200)
const pr = await pageRect(page, 0)
const empty = await page.evaluate(() => {
  const api = window.__paibanApi
  const node = document.querySelectorAll('.ed-page')[0]
  const r = node.getBoundingClientRect()
  const els = api.doc.pages[0].els
  for (let y = 6; y < api.doc.h - 6; y += 14) {
    for (let x = 6; x < api.doc.w - 6; x += 14) {
      if (els.some((e) => x >= e.x - 1 && x <= e.x + e.w + 1 && y >= e.y - 1 && y <= e.y + e.h + 1)) continue
      const cx = r.x + x
      const cy = r.y + y
      if (cx < 4 || cy < 4 || cx > window.innerWidth - 4 || cy > window.innerHeight - 4) continue
      const hit = document.elementFromPoint(cx, cy)
      if (hit && hit.closest('.ed-page') && !hit.closest('.ed-el')) return { cx, cy }
    }
  }
  return null
})
if (!empty) {
  console.log('✗ 第一页找不到空白点')
} else {
  const endX = Math.min(empty.cx + 900, pr.x + pr.w - 8)
  const endY = Math.min(empty.cy + 620, pr.y + pr.h - 8)
  await page.mouse.move(empty.cx, empty.cy)
  await page.mouse.down()
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(empty.cx + ((endX - empty.cx) * i) / 14, empty.cy + ((endY - empty.cy) * i) / 14)
    await sleep(10)
  }
  await page.mouse.up()
  await sleep(400)
  const afterMarquee = await stats()
  console.log(`框选后选中 ${afterMarquee.sel.length} 块`)
  console.log(afterMarquee.sel.length > 1 ? '✓ 空白拖框多选正常' : '✗ 框选没有选中多块')
  await screenshot(page, 'multi-marquee')
}

if (errors.length) {
  console.log('\n=== 运行期报错 ===')
  for (const e of errors.slice(0, 5)) console.log(' ', e)
}
await closeBrowser()
