// 真实环境验收：直接打开线上站点，不注入任何数据，
// 让编辑器自己从 /api/doc 拉推送稿，看会不会崩
//   node tools/import/verify-online.mjs [url]
import fs from 'node:fs'
import { ensureServer, launchBrowser, openEditor, closeBrowser } from '../browser-utils.mjs'

const url = process.argv[2] ?? 'http://47.253.176.114:9705/'
process.env.PAIBAN_URL = url

await ensureServer()
const { browser } = await launchBrowser()
const { page, logs } = await openEditor(browser, { viewport: { width: 1600, height: 1000 } })

// openEditor 已打开并清过一次本地存档，此时 effect 会去拉服务器推送稿
await page.waitForTimeout(3000)

const state = await page.evaluate(() => {
  const api = window.__paibanApi
  const errCard = document.querySelector('.ed-fatal-card')
  if (!api) return { mounted: false, fatal: errCard?.innerText?.slice(0, 300) ?? null }
  const d = api.doc
  const FURN = new Set(['header', 'footer', 'masthead'])
  return {
    mounted: true,
    fatal: errCard ? errCard.innerText.slice(0, 200) : null,
    pages: d.pages.length,
    els: d.pages.reduce((n, p) => n + p.els.length, 0),
    words: d.pages.reduce(
      (n, p) =>
        n +
        p.els
          .filter((e) => !FURN.has(e.variant))
          .map((e) => String(e.html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ''))
          .join('').length,
      0,
    ),
    detail: d.pages.map((p, i) => {
      const body = p.els.filter((e) => !FURN.has(e.variant))
      return {
        page: i + 1,
        n: body.length,
        bottom: Math.round(body.reduce((m, e) => Math.max(m, e.y + e.h), 0)),
      }
    }),
  }
})

const errs = logs.filter((l) => l.type === 'pageerror' || l.type === 'error')
const warns = logs.filter((l) => l.type === 'warning')

console.log(`=== 站点 === ${url}`)
console.log(`=== 编辑器挂载 === ${state.mounted}`)
if (state.fatal) console.log(`=== 错误页 ===\n${state.fatal}`)
if (state.mounted) {
  console.log(`=== 版面 === ${state.pages} 页 / ${state.els} 组件 / ${state.words} 字`)
  for (const p of state.detail) console.log(`   第${p.page}页 ${p.n}块 最低y=${p.bottom}`)
}
console.log(`\n=== 运行时错误（${errs.length}）===`)
errs.slice(0, 6).forEach((e) => console.log('  ✗ ' + e.text.split('\n')[0].slice(0, 160)))
console.log(`\n=== 警告（${warns.length}）===`)
;[...new Set(warns.map((w) => w.text.split('\n')[0]))].slice(0, 6).forEach((t) => console.log('  ! ' + t.slice(0, 160)))

fs.mkdirSync('var/crash', { recursive: true })
await page.screenshot({ path: 'var/crash/online.png' })
console.log('\n截图：var/crash/online.png')

await closeBrowser()
