#!/usr/bin/env node
/**
 * 导入链路自测：真实点一次「Word」按钮，检查版面不变量并截图。
 *
 *   node tools/import/verify.mjs ~/Desktop/docs/地理时政周刊一.doc
 *   node tools/import/verify.mjs ~/Desktop/docs/地理时政周刊一.doc --portrait   # 导入成竖版
 */
import path from 'node:path'
import os from 'node:os'
import { ensureServer, launchBrowser, closeBrowser, openEditor, waitSettled, readState, screenshot, waitImages } from '../browser-utils.mjs'

const argv = process.argv.slice(2)
const wantPortrait = argv.includes('--portrait')
const docPath = path.resolve((argv.find((a) => !a.startsWith('--')) ?? '~/Desktop/docs/地理时政周刊一.doc').replace(/^~/, os.homedir()))

const { started } = await ensureServer()
if (started) console.log('· 已启动 Vite dev server')
const { browser } = await launchBrowser()
const { page, logs } = await openEditor(browser)

const dialogs = []
page.on('dialog', async (d) => {
  dialogs.push(d.message())
  await d.accept()
})

console.log('· 初始页数:', await page.evaluate(() => window.__paibanApi.doc.pages.length))

// 走真实交互：打开 Word 浮层 → 选版式 → 选文件
await page.click('.ed-tb-word')
await page.waitForSelector('.ed-word-pop', { timeout: 5000 })
if (wantPortrait) {
  await page.locator('.ed-word-pop button', { hasText: '竖版' }).click()
  console.log('· 已选「竖版」')
}
const orientBefore = await page.evaluate(() => {
  const on = document.querySelector('.ed-word-pop .ed-word-modes button.is-on')
  return on ? on.textContent.trim() : ''
})
console.log('· 浮层当前版式:', orientBefore)
await page.click('.ed-word-pop .ed-word-go')

await page.setInputFiles('input[accept*=".doc"]', docPath)
await page.waitForFunction(() => window.__paibanApi.doc.pages.length >= 1 && !document.querySelector('.ed-tb-word')?.textContent?.includes('解析中'), null, {
  timeout: 30000,
})
await waitSettled(page)

// 导入结果走应用内通知弹窗（不再用系统 alert）
await page.waitForSelector('.ed-notice', { timeout: 15000 })
const notice = await page.evaluate(() => {
  const n = document.querySelector('.ed-notice')
  return {
    title: n.querySelector('.ed-notice-title')?.textContent ?? '',
    sub: n.querySelector('.ed-notice-sub')?.textContent ?? '',
    stats: [...n.querySelectorAll('.ed-notice-stat')].map(
      (s) => `${s.querySelector('b').textContent} ${s.querySelector('span').textContent}`,
    ),
    notes: [...n.querySelectorAll('.ed-notice-notes li')].map((li) => li.textContent),
  }
})
console.log('\n=== 导入结果 ===')
console.log(notice.title + (notice.sub ? `\n${notice.sub}` : ''))
console.log(notice.stats.join(' · '))
if (notice.notes.length) console.log(`提示:\n· ${notice.notes.join('\n· ')}`)
if (dialogs.length) console.log('⚠ 仍出现系统弹窗:', dialogs.join(' / '))
await page.locator('.ed-notice-foot button', { hasText: '知道了' }).click()
await new Promise((r) => setTimeout(r, 200))

const state = await readState(page)
console.log('\n版式:', state.orientation === 'portrait' ? 'A4 竖版' : 'A4 横版', `(${state.w} × ${state.h})`)
console.log('页数:', state.pages, '| 元素:', state.total, '| 页脚:', state.footerLabels.join(' / '))
console.table(state.pageStats)
console.log('超出边界:', state.outside.length, '| 重叠:', state.overlaps.length, '| 溢出页底:', state.overflowing.length)
console.log('与页眉页脚重叠:', state.furnitureOverlaps.length, '| 内容溢出框:', state.contentOverflow.length)
if (state.contentOverflow.length) console.log(JSON.stringify(state.contentOverflow.slice(0, 5)))
if (state.overlaps.length) console.log(JSON.stringify(state.overlaps.slice(0, 5)))

const variants = await page.evaluate(() => {
  const api = window.__paibanApi
  const out = {}
  for (const p of api.doc.pages) for (const e of p.els) out[e.variant] = (out[e.variant] || 0) + 1
  return out
})
console.log('变体:', variants)

const errors = logs.filter((l) => l.type === 'pageerror' || l.type === 'error')
if (errors.length) console.log('\n运行期错误:', errors.map((e) => e.text).join('\n'))

await waitImages(page)

for (let i = 0; i < state.pages; i++) {
  await page.evaluate((idx) => {
    const node = document.querySelectorAll('.ed-page')[idx]
    const wrap = node.closest('.ed-page-wrap')
    const scroller = document.querySelector('.ed-canvas-scroll')
    if (wrap && scroller) {
      scroller.scrollTop = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 10
    }
  }, i)
  await new Promise((r) => setTimeout(r, 250))
  console.log('· 截图', await screenshot(page, `import-p${i + 1}.png`))
}

await closeBrowser()
