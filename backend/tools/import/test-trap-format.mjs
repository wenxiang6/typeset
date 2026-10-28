#!/usr/bin/env node
/**
 * 验证「一个容器里有多个并列行内元素」也会竖着排：
 *   <div class="trap"><span class="x">x</span><span class="t">…</span></div>
 * 应变成四空格缩进的三行以上，而不是挤成一行。
 *
 *   node backend/tools/import/test-trap-format.mjs [var/issue1/out2.json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { ensureServer, launchBrowser, openEditor, closeBrowser, sleep, screenshot } from '../browser-utils.mjs'

const src = process.argv[2] ?? 'var/issue1/out2.json'
const raw = fs.readFileSync(path.resolve(src), 'utf8')
await ensureServer()
const { browser } = await launchBrowser()
const { page } = await openEditor(browser, { viewport: { width: 1600, height: 1000 } })
const base = page.url()
await page.addInitScript(
  ({ d }) => {
    localStorage.setItem('paiban-editor-doc-v1', d)
    for (const k of Object.keys(localStorage)) if (k.startsWith('paiban-push-seen')) localStorage.removeItem(k)
  },
  { d: raw },
)
await page.goto(base, { waitUntil: 'load' })
await page.waitForFunction(() => !!window.__paibanApi, null, { timeout: 20000 })
await sleep(1200)

const target = await page.evaluate(() => {
  const api = window.__paibanApi
  const el = api.doc.pages.flatMap((p) => p.els).find((e) => e.variant === 'trap' && e.html)
  return el ? { id: el.id, html: el.html } : null
})
if (!target) {
  console.log('✗ 稿子里没有 trap 组件')
  await closeBrowser()
  process.exit(1)
}
console.log('原始：' + target.html)

await page.evaluate((id) => {
  const api = window.__paibanApi
  api.setPageIdx(api.doc.pages.findIndex((p) => p.els.some((e) => e.id === id)))
  api.setSelection(id)
}, target.id)
await sleep(300)
await page.locator('.ed-insp-row button', { hasText: '编辑 HTML' }).first().click()
await sleep(700)

const info = await page.evaluate(() => {
  const areas = Array.from(document.querySelectorAll('.ed-code-input'))
  const el = areas[areas.length - 1]
  const lines = (el?.value ?? '').split('\n')
  return { lines, indent4: lines.filter((l) => /^ {4}\S/.test(l)).length }
})
console.log('\n格式化后：')
for (const l of info.lines) console.log('  |' + l)
const ok = info.lines.length >= 3 && info.indent4 >= 2 && info.lines[0].trim().startsWith('<div')
console.log(ok ? '✓ 多个并列元素已竖排 + 四空格缩进' : '✗ 仍然挤在一行')
await screenshot(page, 'trap-format')
await closeBrowser()
