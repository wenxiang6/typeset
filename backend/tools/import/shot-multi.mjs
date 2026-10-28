#!/usr/bin/env node
/** 多选右键菜单截图（人工看一眼版式用） */
import fs from 'node:fs'
import { ensureServer, launchBrowser, openEditor, closeBrowser, sleep, screenshot, pageRect } from '../browser-utils.mjs'

const raw = fs.readFileSync('var/issue1/out2.json', 'utf8')
await ensureServer()
const { browser } = await launchBrowser()
const { page } = await openEditor(browser, { viewport: { width: 1600, height: 1000 } })
await page.addInitScript(({ docRaw }) => {
  localStorage.setItem('paiban-editor-doc-v1', docRaw)
}, { docRaw: raw })
await page.goto(page.url(), { waitUntil: 'load' })
await page.waitForFunction(() => !!window.__paibanApi, null, { timeout: 20000 })
await sleep(1200)
await pageRect(page, 0)
await sleep(300)

const pick = await page.evaluate(() => {
  const api = window.__paibanApi
  const cands = api.doc.pages[0].els
    .filter((e) => e.html && (e.kind === 'text' || e.kind === 'box') && !e.locked && !e.background && e.kind !== 'region')
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const by = new Map()
  for (const e of cands) {
    const arr = by.get(e.variant) ?? []
    arr.push(e)
    by.set(e.variant, arr)
  }
  for (const arr of by.values()) if (arr.length >= 2) return { a: arr[0].id, b: arr[1].id }
  return null
})
if (pick) {
  const locA = page.locator(`.ed-el[data-el-id="${pick.a}"]`).first()
  await locA.scrollIntoViewIfNeeded()
  const ba = await locA.boundingBox()
  await page.mouse.click(ba.x + 30, ba.y + 12)
  await sleep(200)
  const locB = page.locator(`.ed-el[data-el-id="${pick.b}"]`).first()
  const bb = await locB.boundingBox()
  await page.keyboard.down('Shift')
  await page.mouse.click(bb.x + 30, bb.y + 12)
  await page.keyboard.up('Shift')
  await sleep(300)
  await page.mouse.click(bb.x + 30, bb.y + 12, { button: 'right' })
  await sleep(400)
  const cs = await page.evaluate(() => {
    const m = document.querySelector('.ed-ctxmenu')
    if (!m) return null
    const s = getComputedStyle(m)
    const r = m.getBoundingClientRect()
    return { bg: s.backgroundColor, opacity: s.opacity, w: r.width, h: r.height, z: s.zIndex, filter: s.filter, backdrop: s.backdropFilter }
  })
  console.log('菜单样式', cs)
  await page.locator('.ed-ctxmenu').screenshot({ path: 'artifacts/smoke/multi-ctxmenu-zoom.png' })
  await page.screenshot({ path: 'artifacts/smoke/multi-ctxmenu.png' })
  console.log('saved artifacts/smoke/multi-ctxmenu.png', await page.locator('.ed-ctxmenu').count())
}
await closeBrowser()
