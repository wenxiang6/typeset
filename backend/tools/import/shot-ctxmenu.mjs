import fs from 'node:fs'
import { ensureServer, launchBrowser, openEditor, closeBrowser, sleep } from '../browser-utils.mjs'

const raw = fs.readFileSync('var/issue1/out2.json', 'utf8')
await ensureServer()
const { browser } = await launchBrowser()
const { page } = await openEditor(browser, { viewport: { width: 1600, height: 1000 } })
await page.addInitScript(
  ({ k, r }) => {
    localStorage.setItem(k, r)
    for (const key of Object.keys(localStorage)) if (key.startsWith('paiban-push-seen')) localStorage.removeItem(key)
  },
  { k: 'paiban-editor-doc-v1', r: raw },
)
await page.goto(page.url(), { waitUntil: 'load' })
await page.waitForFunction(() => !!window.__paibanApi, null, { timeout: 20000 })
await sleep(1500)

// 目标块在第 3 页，先滚进视口，否则算出来的坐标在屏幕外，右键点空
const box = await page.evaluate(async () => {
  const el = window.__paibanApi.doc.pages[2].els.find((e) => e.variant === 'quiz')
  const node = document.querySelector(`[data-el-id="${el.id}"]`)
  node.scrollIntoView({ block: 'center' })
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const r = node.getBoundingClientRect()
  return { x: r.left + 80, y: r.top + 40 }
})
await page.mouse.click(box.x, box.y, { button: 'right' })
await sleep(400)
await page.screenshot({ path: 'var/shots-ctxmenu.png' })
console.log('截图：var/shots-ctxmenu.png')
await closeBrowser()
