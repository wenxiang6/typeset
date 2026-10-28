// 直接调排版函数，验证「测量写回 → reflow 夹回」的拉锯
//   node tools/import/probe-geom.mjs var/crash/doc.json imp-49-2-3
import fs from 'node:fs'
import { ensureServer, launchBrowser, openEditor, closeBrowser } from '../browser-utils.mjs'

const src = process.argv[2] ?? 'var/crash/doc.json'
const wantId = process.argv[3] ?? 'imp-49-2-3'
const raw = fs.readFileSync(src, 'utf8')

await ensureServer()
const { browser } = await launchBrowser()
const { page } = await openEditor(browser, { viewport: { width: 1600, height: 1000 } })
const base = page.url()

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
await page.waitForTimeout(2500)

const out = await page.evaluate(async (id) => {
  const api = window.__paibanApi
  if (!api) return { err: '编辑器未挂载' }
  const L = await import('/src/editor/layout.ts')

  const res = { pages: api.doc.pages.length, where: null, geom: [], trial: [] }
  let pi = -1
  for (let i = 0; i < api.doc.pages.length; i++) {
    if (api.doc.pages[i].els.some((e) => e.id === id)) {
      pi = i
      break
    }
  }
  if (pi < 0) {
    res.err = '找不到元素（可能已被重建），当前 id 列表前 5 个：'
    res.ids = api.doc.pages.flatMap((p) => p.els.map((e) => e.id)).slice(0, 5)
    return res
  }
  const el = api.doc.pages[pi].els.find((e) => e.id === id)
  res.where = { page: pi + 1, variant: el.variant, y: el.y, h: el.h, w: el.w }

  // 页几何
  const g = L.getGeometry(api.doc, pi)
  res.geom.push({ page: pi + 1, top: g.top, bottom: g.bottom, height: g.height, colW: g.colW })

  // 试用 applyHeights：把该块写成 649（测量值），看 reflow 后变成多少
  for (const target of [el.h + 7.6, 649, 660]) {
    const d = JSON.parse(JSON.stringify(api.doc))
    const before = (() => {
      for (const p of d.pages) {
        const e = p.els.find((x) => x.id === id)
        if (e) return { page: d.pages.indexOf(p) + 1, y: e.y, h: e.h }
      }
      return null
    })()
    const after = L.applyHeights(d, { [id]: target }, { growLocked: true })
    let hit = null
    for (let i = 0; i < after.pages.length; i++) {
      const e = after.pages[i].els.find((x) => x.id === id)
      if (e) hit = { page: i + 1, y: Math.round(e.y * 10) / 10, h: Math.round(e.h * 10) / 10, bottom: Math.round((e.y + e.h) * 10) / 10 }
    }
    res.trial.push({ target: Math.round(target * 10) / 10, before, after: hit, pages: after.pages.length })
  }
  return res
}, wantId)

console.log(JSON.stringify(out, null, 1))
await closeBrowser()
