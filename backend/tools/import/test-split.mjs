#!/usr/bin/env node
/**
 * 拆块 / 合并的端到端验证。
 *
 *   node tools/import/test-split.mjs var/issue1/out2.json
 *
 * 在真实编辑器里跑：找子节点最多的那个块 → 按段落拆 → 校验文字一个字没丢、
 * 元素数变多、页数不变离谱；再把拆出来的前两块合并回去 → 元素数回到拆之前。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ensureServer, launchBrowser, openEditor, closeBrowser, sleep } from '../browser-utils.mjs'

const src = process.argv[2] ?? 'var/issue1/out2.json'
const raw = fs.readFileSync(path.resolve(src), 'utf8')
// 先确认能解析，别把坏文件塞进浏览器
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

const result = await page.evaluate(async () => {
  // 注意：api 是每次 render 生成的快照对象，调用后 api.doc 仍是旧数据。
  // 所以每次统计都要重新取 window.__paibanApi，否则量出来的是改动前的版面。
  const api = () => window.__paibanApi
  const cn = (t) => (String(t ?? '').replace(/<[^>]+>/g, '').match(/[\u4e00-\u9fa5]/g) || []).length
  const allHtml = () => api().doc.pages.flatMap((p) => p.els.map((e) => e.html ?? '')).join('')
  const els = () => api().doc.pages.reduce((n, p) => n + p.els.length, 0)

  // 子节点最多的块（最值得拆的就是它）
  const cands = api().doc.pages
    .flatMap((p) => p.els)
    .filter((e) => e.html)
    .map((e) => ({ el: e, parts: (e.html.match(/<[a-zA-Z]/g) ?? []).length }))
    .sort((a, b) => b.parts - a.parts)
  const target = cands[0]
  if (!target) return { error: '文档里没有可拆的块' }

  const before = { pages: api().doc.pages.length, els: els(), chars: cn(allHtml()) }
  const targetHtmlChars = cn(target.el.html)

  const made = api().splitElement(target.el.id, 'nodes')
  await new Promise((r) => setTimeout(r, 900))

  const afterSplit = { pages: api().doc.pages.length, els: els(), chars: cn(allHtml()) }

  // 拆出来的第一块（会自动被选中）
  const firstId = api().selection
  const merged = firstId ? api().mergeWithNext(firstId) : false
  await new Promise((r) => setTimeout(r, 900))

  const afterMerge = { pages: api().doc.pages.length, els: els(), chars: cn(allHtml()) }

  return {
    target: { variant: target.el.variant, parts: target.parts, chars: targetHtmlChars },
    before,
    made,
    afterSplit,
    merged,
    afterMerge,
  }
})

console.log('=== 拆块验证 ===')
if (result.error) {
  console.log('✗', result.error)
} else {
  const { target, before, made, afterSplit, merged, afterMerge } = result
  console.log(`目标块：${target.variant}，${target.parts} 个标签，${target.chars} 汉字`)
  console.log(`拆分段数：${made}`)
  console.log(`  拆前  页 ${before.pages}  元素 ${before.els}  汉字 ${before.chars}`)
  console.log(`  拆后  页 ${afterSplit.pages}  元素 ${afterSplit.els}  汉字 ${afterSplit.chars}`)
  console.log(`  合并  元素 ${afterMerge.els}  汉字 ${afterMerge.chars}（merged=${merged}）`)
  const lossSplit = before.chars - afterSplit.chars
  const growSplit = afterSplit.els - before.els
  console.log('')
  console.log(lossSplit === 0 ? '✓ 拆分后文字零丢失' : `✗ 拆分丢了 ${lossSplit} 字`)
  console.log(growSplit === made - 1 ? `✓ 元素数按预期 +${growSplit}` : `✗ 元素数变化异常：+${growSplit}（期望 +${made - 1}）`)
  // 只合并了一对，所以元素数应比拆完少 1（不是回到拆之前）
  const expectAfterMerge = afterSplit.els - 1
  console.log(
    afterMerge.els === expectAfterMerge
      ? `✓ 合并一对后元素数 ${afterMerge.els}（拆完 ${afterSplit.els} - 1）`
      : `✗ 合并后元素数 ${afterMerge.els}（应为 ${expectAfterMerge}）`,
  )
  console.log(merged ? '✓ mergeWithNext 返回 true' : '✗ mergeWithNext 返回 false')
}
if (errors.length) {
  console.log('\n=== 运行期报错 ===')
  for (const e of errors.slice(0, 5)) console.log(' ', e)
}
await closeBrowser()
