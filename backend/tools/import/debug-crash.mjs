// 复现「打开页面即崩」：把指定 doc 塞进 localStorage，重载，抓 React 报错堆栈
//   node tools/import/debug-crash.mjs var/crash/doc.json
import fs from 'node:fs'
import { ensureServer, launchBrowser, openEditor, closeBrowser } from '../browser-utils.mjs'

const src = process.argv[2] ?? 'var/crash/doc.json'
const raw = fs.readFileSync(src, 'utf8')

await ensureServer()
const { browser } = await launchBrowser()
// 直接用 openEditor 打开的页面，避免 about:blank 上拿不到 localStorage
const { page } = await openEditor(browser, { viewport: { width: 1600, height: 1000 } })
const base = page.url()

const errors = []
page.on('pageerror', (e) => errors.push({ kind: 'pageerror', text: e.message, stack: e.stack ?? '' }))
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push({ kind: m.type(), text: m.text() })
})

// 塞存档 + 清掉推送消费标记，模拟「服务器有新推送，首次打开」
await page.evaluate(
  ({ docKey, raw }) => {
    localStorage.setItem(docKey, raw)
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('paiban-push-seen')) localStorage.removeItem(k)
    }
  },
  { docKey: 'paiban-editor-doc-v1', raw },
)

errors.length = 0
await page.goto(base, { waitUntil: 'load' })
await page.waitForTimeout(2500)

console.log('=== 页面标题 ===', await page.title())
console.log('=== 报错 ===')
if (!errors.length) console.log('（无）')
for (const e of errors.slice(0, 12)) {
  console.log(`\n[${e.kind}] ${e.text.slice(0, 400)}`)
  if (e.stack) console.log(e.stack.split('\n').slice(0, 12).join('\n'))
}

const alive = await page.evaluate(() => !!window.__paibanApi)
console.log('\n=== 编辑器挂载 ===', alive)

// 页数 / 每页元素 / 溢出情况，比 body 文字有用得多
const stat = await page.evaluate(() => {
  const api = window.__paibanApi
  if (!api) return null
  const d = api.doc
  const FURN = new Set(['header', 'footer', 'masthead'])
  const pages = d.pages.map((p, i) => {
    const body = p.els.filter((e) => !FURN.has(e.variant))
    const bottom = body.reduce((m, e) => Math.max(m, e.y + e.h), 0)
    const deep = body.filter((e) => e.y + e.h > d.h - 60).map((e) => `${e.variant}@${Math.round(e.y)}+${Math.round(e.h)}`)
    return { i: i + 1, n: body.length, bottom: Math.round(bottom), deep }
  })
  return { pages: d.pages.length, w: Math.round(d.w), h: Math.round(d.h), detail: pages }
})
if (stat) {
  console.log(`=== 版面 === ${stat.pages} 页  ${stat.w}x${stat.h}`)
  for (const p of stat.detail) {
    console.log(`  第${p.i}页  正文${p.n}块  最低y=${p.bottom}${p.deep.length ? '  触底: ' + p.deep.join(', ') : ''}`)
  }
}

fs.mkdirSync('var/crash', { recursive: true })
await page.screenshot({ path: 'var/crash/repro.png', fullPage: false })
console.log('\n截图：var/crash/repro.png')

await closeBrowser()
