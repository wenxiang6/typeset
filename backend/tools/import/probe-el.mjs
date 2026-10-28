// 采样某个元素的几何变化轨迹，看它被谁反复改
//   node tools/import/probe-el.mjs var/crash/doc.json imp-49-2-3
import fs from 'node:fs'
import { ensureServer, launchBrowser, openEditor, closeBrowser } from '../browser-utils.mjs'

const src = process.argv[2] ?? 'var/crash/doc.json'
const wantId = process.argv[3] ?? 'imp-49-2-3'
const raw = fs.readFileSync(src, 'utf8')

await ensureServer()
const { browser } = await launchBrowser()
const { page } = await openEditor(browser, { viewport: { width: 1600, height: 1000 } })
const base = page.url()

const logs = []
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('[paiban]')) logs.push(t)
})

// 用 addInitScript 在「新文档创建后、页面脚本执行前」写入，
// 否则编辑器自己的自动保存会把我们塞的稿子覆盖掉（实测踩过：加载出来的是初始模板）
await page.addInitScript(
  ({ docKey, raw }) => {
    try {
      localStorage.setItem(docKey, raw)
      for (const k of Object.keys(localStorage)) if (k.startsWith('paiban-push-seen')) localStorage.removeItem(k)
    } catch {
      /* 忽略 */
    }
  },
  { docKey: 'paiban-editor-doc-v1', raw },
)
await page.goto(base, { waitUntil: 'load' })

// 连续采样：位置/高度/所在页，任何一次变化都记下来
const trace = await page.evaluate(async (id) => {
  const out = []
  for (let k = 0; k < 40; k++) {
    await new Promise((r) => setTimeout(r, 60))
    const api = window.__paibanApi
    if (!api) {
      out.push({ k, missing: true })
      continue
    }
    let hit = null
    for (let pi = 0; pi < api.doc.pages.length; pi++) {
      const el = api.doc.pages[pi].els.find((e) => e.id === id)
      if (el) {
        hit = { k, page: pi + 1, y: Math.round(el.y * 10) / 10, h: Math.round(el.h * 10) / 10, pages: api.doc.pages.length }
        break
      }
    }
    out.push(hit ?? { k, gone: true, pages: api.doc.pages.length })
  }
  return out
}, wantId)

// 只打印有变化的帧
let prev = ''
console.log(`=== ${wantId} 采样（只显示变化）===`)
for (const t of trace) {
  const sig = JSON.stringify({ ...t, k: 0 })
  if (sig === prev) continue
  prev = sig
  console.log(' ', JSON.stringify(t))
}

const uniq = new Set(trace.map((t) => `${t.page}:${t.h}`))
console.log(`\n不同状态数：${uniq.size}`, [...uniq].join('  '))
console.log(`最终页数：${trace[trace.length - 1]?.pages}`)

console.log('\n=== [paiban] 日志 ===')
console.log(logs.length ? [...new Set(logs)].slice(0, 10).join('\n') : '（无）')

await closeBrowser()
