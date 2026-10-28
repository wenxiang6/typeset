// 修复效果验收：载入崩稿 → 等稳定 → 对比内容是否完整、版面是否收敛
//   node tools/import/verify-fix.mjs var/crash/doc.json
import fs from 'node:fs'
import { ensureServer, launchBrowser, openEditor, closeBrowser } from '../browser-utils.mjs'

const src = process.argv[2] ?? 'var/crash/doc.json'
const raw = fs.readFileSync(src, 'utf8')
const orig = JSON.parse(raw)

await ensureServer()
const { browser } = await launchBrowser()
const { page } = await openEditor(browser, { viewport: { width: 1600, height: 1000 } })
const base = page.url()

const warns = []
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('[paiban]')) warns.push(t)
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

// 等版面彻底稳定：连续两次采样一致
let sig = ''
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(120)
  const s = await page.evaluate(() =>
    JSON.stringify(window.__paibanApi?.doc.pages.map((p) => p.els.map((e) => [e.id, Math.round(e.y), Math.round(e.h)]))),
  )
  if (s === sig) break
  sig = s
}

// 逐页截图，肉眼确认没有压字/重叠
const pageCount = await page.evaluate(() => window.__paibanApi.doc.pages.length)
fs.mkdirSync('var/crash/shots', { recursive: true })
for (let i = 0; i < pageCount; i++) {
  await page.evaluate((idx) => {
    const nodes = document.querySelectorAll('.ed-page')
    nodes[idx]?.scrollIntoView({ block: 'center' })
  }, i)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `var/crash/shots/p${i + 1}.png` })
}
console.log(`\n逐页截图：var/crash/shots/p1..${pageCount}.png`)

const got = await page.evaluate(() => JSON.parse(JSON.stringify(window.__paibanApi.doc)))
await closeBrowser()

const strip = (h) => String(h ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const count = (d) => {
  const c = {}
  for (const p of d.pages) for (const e of p.els) c[e.variant] = (c[e.variant] || 0) + 1
  return c
}
const texts = (d) =>
  d.pages
    .flatMap((p) => p.els)
    .filter((e) => !['header', 'footer', 'masthead'].includes(e.variant))
    .map((e) => strip(e.html))
    .filter(Boolean)

const CO = count(orig)
const CG = count(got)
const TO = texts(orig).join('')
const TG = texts(got).join('')

console.log('=== 页数 ===')
console.log(`  原始 ${orig.pages.length} 页 → 现在 ${got.pages.length} 页`)
console.log('\n=== 组件数（原始 vs 现在）===')
for (const k of [...new Set([...Object.keys(CO), ...Object.keys(CG)])].sort()) {
  const a = CO[k] ?? 0
  const b = CG[k] ?? 0
  console.log(`  ${k.padEnd(14)} ${String(a).padStart(3)} → ${String(b).padStart(3)} ${a === b ? '' : a > b ? '← 少了' : '← 多了'}`)
}
console.log(`  合计            ${String(Object.values(CO).reduce((a, b) => a + b, 0)).padStart(3)} → ${String(Object.values(CG).reduce((a, b) => a + b, 0)).padStart(3)}`)

console.log('\n=== 文字量 ===')
console.log(`  原始 ${TO.length} 字 → 现在 ${TG.length} 字（差 ${TG.length - TO.length}）`)

// 逐段比对：原始里每段文字是否还能在现在的内容里找到
const missing = texts(orig).filter((t) => t.length > 8 && !TG.includes(t.slice(0, 20)))
console.log(`\n=== 内容缺失检查 ===  丢失段落：${missing.length}`)
missing.slice(0, 5).forEach((t) => console.log('  ✗ ' + t.slice(0, 60)))

console.log('\n=== 每页填充 ===')
const FURN = new Set(['header', 'footer', 'masthead'])
got.pages.forEach((p, i) => {
  const body = p.els.filter((e) => !FURN.has(e.variant))
  const bottom = body.reduce((m, e) => Math.max(m, e.y + e.h), 0)
  const over = body.filter((e) => e.y + e.h > 733).map((e) => `${e.variant} ${Math.round(e.y + e.h)}`)
  console.log(`  第${i + 1}页 ${String(body.length).padStart(2)}块 最低y=${Math.round(bottom)}${over.length ? '  超出页底: ' + over.join(', ') : ''}`)
})

console.log('\n=== [paiban] 警告 ===')
console.log(warns.length ? [...new Set(warns)].join('\n') : '（无）')
