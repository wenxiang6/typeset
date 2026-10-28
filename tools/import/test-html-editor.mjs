#!/usr/bin/env node
/**
 * HTML 抽屉的验证：格式化、按标签名分色、自动换行开关、Tab 缩进、应用写回。
 *
 *   node tools/import/test-html-editor.mjs [var/issue1/out2.json]
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

const target = await page.evaluate(() => {
  const api = window.__paibanApi
  const cands = api.doc.pages
    .flatMap((p) => p.els)
    .filter((e) => e.html && (e.kind === 'text' || e.kind === 'box') && !e.locked && !e.background)
    .map((e) => ({ id: e.id, nodes: (e.html.match(/<[a-zA-Z]/g) ?? []).length }))
    .sort((a, b) => b.nodes - a.nodes)
  return cands[0] ?? null
})
if (!target) {
  console.log('✗ 没有可编辑的文字块')
  await closeBrowser()
  process.exit(1)
}
console.log(`目标组件：${target.id}，原始 ${target.nodes} 个标签`)

await page.evaluate((id) => {
  const api = window.__paibanApi
  const pageIdx = api.doc.pages.findIndex((p) => p.els.some((e) => e.id === id))
  api.setPageIdx(pageIdx)
  api.setSelection(id)
}, target.id)
await sleep(300)

const btn = page.locator('.ed-insp-row button', { hasText: '编辑 HTML' }).first()
if (!(await btn.count())) {
  console.log('✗ 属性面板里找不到「编辑 HTML」按钮')
  await closeBrowser()
  process.exit(1)
}
await btn.click()
await sleep(800)

const readCode = () =>
  page.evaluate(() => {
    const code = document.querySelector('.ed-code')
    const areas = Array.from(document.querySelectorAll('.ed-code-input'))
    const el = areas[areas.length - 1]
    const pres = Array.from(document.querySelectorAll('.ed-code-hl'))
    const pre = pres[pres.length - 1]
    const colors = new Set(Array.from(pre?.querySelectorAll('span.tk-tag') ?? []).map((s) => getComputedStyle(s).color))
    const text = el?.value ?? ''
    const lines = text.split('\n')
    return {
      isWrap: code?.classList.contains('is-wrap') ?? false,
      overflowX: el ? el.scrollWidth - el.clientWidth : -1,
      hasGutter: !!document.querySelector('.ed-code-gutter'),
      lines: lines.length,
      indent4: lines.filter((l) => /^ {4}\S/.test(l)).length,
      firstLines: lines.slice(0, 5),
      tagColors: [...colors],
      spans: pre?.querySelectorAll('span').length ?? 0,
    }
  })

const on = await readCode()
console.log(`源码 ${on.lines} 行，四空格缩进 ${on.indent4} 行，高亮片段 ${on.spans} 个`)
console.log('前几行：')
for (const l of on.firstLines) console.log('  |' + l)
console.log(`标签色 ${on.tagColors.length} 种`)
console.log(on.lines > 3 && on.indent4 > 0 ? '✓ 已按标签分行 + 四空格缩进' : '✗ 格式化不对')
console.log(on.tagColors.length >= 2 ? '✓ 不同标签用了不同颜色' : '✗ 标签颜色没有区分')
console.log(`自动换行默认${on.isWrap ? '开' : '关'}，横向溢出 ${on.overflowX}px，行号${on.hasGutter ? '显示' : '隐藏'}`)
console.log(on.isWrap && on.overflowX <= 1 ? '✓ 长行自动折行，不再超出可视区' : '✗ 自动换行未生效')
await screenshot(page, 'html-editor-wrap')

await page.locator('.ed-htmlsplit-foot button', { hasText: '自动换行' }).click()
await sleep(400)
const off = await readCode()
console.log(`关掉后：自动换行${off.isWrap ? '开' : '关'}，横向溢出 ${off.overflowX}px，行号${off.hasGutter ? '显示' : '隐藏'}`)
console.log(!off.isWrap && off.hasGutter && off.overflowX > 1 ? '✓ 关闭后恢复横向滚动 + 行号' : '✗ 关闭换行后状态不对')
await screenshot(page, 'html-editor-nowrap')
await page.locator('.ed-htmlsplit-foot button', { hasText: '自动换行' }).click()
await sleep(300)

const beforeTab = await page.evaluate(() => {
  const areas = Array.from(document.querySelectorAll('.ed-code-input'))
  const el = areas[areas.length - 1]
  el.focus()
  el.setSelectionRange(0, 0)
  return el.value.slice(0, 20)
})
await page.keyboard.press('Tab')
await sleep(250)
const afterTab = await page.evaluate(() => {
  const areas = Array.from(document.querySelectorAll('.ed-code-input'))
  const el = areas[areas.length - 1]
  return el.value.slice(0, 24)
})
console.log(`Tab 前「${beforeTab}」→ 后「${afterTab}」`)
console.log(afterTab.startsWith('    ') ? '✓ Tab 插入 4 个空格' : '✗ Tab 缩进不对')

const before = await page.evaluate((id) => {
  const api = window.__paibanApi
  return api.doc.pages.flatMap((p) => p.els).find((e) => e.id === id)?.html ?? ''
}, target.id)
await page.locator('.ed-htmlsplit-foot button', { hasText: '应用' }).click()
await sleep(800)
await waitSettled(page)
const after = await page.evaluate((id) => {
  const api = window.__paibanApi
  return api.doc.pages.flatMap((p) => p.els).find((e) => e.id === id)?.html ?? ''
}, target.id)
console.log(`写回后 html ${before.length} → ${after.length} 字符`)
console.log(after.includes('\n') ? '✓ 写回的是格式化后的 HTML' : '✗ 写回内容异常')

if (errors.length) {
  console.log('\n=== 运行期报错 ===')
  for (const e of errors.slice(0, 5)) console.log(' ', e)
}
await closeBrowser()
