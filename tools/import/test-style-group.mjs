#!/usr/bin/env node
/**
 * 多选统一改外观的端到端验证（真实鼠标 + 真实下拉，不走 api 直调）。
 *
 *   node tools/import/test-style-group.mjs [var/issue1/out2.json]
 *
 * 验证四件事：
 *   1. Shift 点两块 → 属性面板出现「已选 2 块」；
 *   2. 在面板里把「字号」改成 16 → 两块 style.fontSize 都变成 16px；
 *   3. Ctrl+Z 撤销一次 → 两块同时回到原字号（整批只算一步）；
 *   4. 位置尺寸不被批量改（两块 x/y 保持不变）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ensureServer, launchBrowser, openEditor, closeBrowser, sleep, screenshot, waitSettled } from '../browser-utils.mjs'

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

// 第一页上同 variant、可编辑的前两个块
const pick = await page.evaluate(() => {
  const api = window.__paibanApi
  const cands = api.doc.pages[0].els
    .filter((e) => e.html && e.kind === 'text' && !e.locked && !e.background && e.variant !== 'name-row')
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const byVariant = new Map()
  for (const e of cands) {
    const arr = byVariant.get(e.variant) ?? []
    arr.push(e)
    byVariant.set(e.variant, arr)
  }
  for (const [variant, arr] of byVariant) {
    if (arr.length >= 2) {
      return {
        variant,
        ids: [arr[0].id, arr[1].id],
        before: arr.slice(0, 2).map((e) => ({
          id: e.id,
          fontSize: e.style?.fontSize ?? '',
          x: Math.round(e.x),
          y: Math.round(e.y),
          w: Math.round(e.w),
          h: Math.round(e.h),
        })),
      }
    }
  }
  return null
})
if (!pick) {
  console.log('✗ 第一页找不到两个同类型文字块')
  await closeBrowser()
  process.exit(1)
}
console.log(`目标：${pick.variant} 两块 → ${pick.before.map((b) => `${b.id}(${b.fontSize || '默认'})`).join(' ')}`)

const clickEl = async (id, modifiers = []) => {
  const loc = page.locator(`.ed-el[data-el-id="${id}"]`).first()
  await loc.scrollIntoViewIfNeeded()
  await sleep(120)
  const box = await loc.boundingBox()
  for (const m of modifiers) await page.keyboard.down(m)
  await page.mouse.move(box.x + Math.min(40, box.width / 2), box.y + Math.min(14, box.height / 2))
  await page.mouse.down()
  await page.mouse.up()
  for (const m of modifiers) await page.keyboard.up(m)
  await sleep(260)
}

const read = () =>
  page.evaluate((ids) => {
    const api = window.__paibanApi
    const all = api.doc.pages.flatMap((p) => p.els)
    return ids.map((id) => {
      const e = all.find((x) => x.id === id)
      return e ? { id, fontSize: e.style?.fontSize ?? '', x: Math.round(e.x), y: Math.round(e.y) } : null
    })
  }, pick.ids)

await clickEl(pick.ids[0])
await clickEl(pick.ids[1], ['Shift'])
const selCount = await page.evaluate(() => window.__paibanApi.selectedIds.length)
const banner = await page.locator('.ed-insp-multi').textContent().catch(() => '')
console.log(`选中 ${selCount} 块；面板提示：${(banner || '').replace(/\s+/g, ' ').slice(0, 80)}`)
console.log(selCount === 2 ? '✓ Shift 多选正常' : '✗ 多选数量不对')

// 面板里改字号（找「字号」那格的下拉）
const cell = page.locator('.ed-fg-cell').filter({ has: page.locator('.ed-fg-label', { hasText: /^字号$/ }) }).first()
const cellCount = await cell.count()
if (!cellCount) {
  console.log('✗ 属性面板里找不到「字号」下拉')
} else {
  await cell.locator('select').selectOption('16')
  await sleep(900)
  await waitSettled(page)
  const after = await read()
  const both = after.every((r) => r && r.fontSize === '16px')
  console.log(`改字号后：${after.map((r) => `${r.id}=${r.fontSize || '默认'}`).join(' ')}`)
  console.log(both ? '✓ 两块字号同时变成 16px' : '✗ 只改到了其中一块')

  // 位置字段不该被批量写：x 必须保持不变（y 会因字号变大、重排而正常下移）
  const xSame = after.every((r, i) => r && r.x === pick.before[i].x)
  const yMoved = after.some((r, i) => r && r.y !== pick.before[i].y)
  console.log(
    xSame
      ? `✓ 横向位置未被批量修改${yMoved ? '（y 因重排正常变化）' : ''}`
      : '✗ 横坐标被意外改动',
  )

  await screenshot(page, 'multi-style')

  // Ctrl+Z 一次 → 两块都回原值
  await page.keyboard.press('Control+z')
  await sleep(700)
  const undone = await read()
  const back = undone.every((r, i) => r && r.fontSize === pick.before[i].fontSize)
  console.log(`撤销后：${undone.map((r) => `${r.id}=${r.fontSize || '默认'}`).join(' ')}`)
  console.log(back ? '✓ 一次撤销同时回退两块（整批算一步）' : '✗ 撤销没有同时回退')
}

if (errors.length) {
  console.log('\n=== 运行期报错 ===')
  for (const e of errors.slice(0, 5)) console.log(' ', e)
}
await closeBrowser()
