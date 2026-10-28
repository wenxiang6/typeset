#!/usr/bin/env node
/**
 * 验证「外部推送 → 打开页面自动载入」这条链路。
 *
 *   node tools/import/test-push.mjs [服务器地址] [要推送的JSON]
 *
 * 默认 http://127.0.0.1:8099（本地跑 server.mjs），只验证行为：
 *   1. 页面首开（无本地存档）→ 应从服务器拉；
 *   2. 模拟用户微调（写一份带标记的本地存档）；
 *   3. 带 ?push=1 推一份新稿；
 *   4. 刷新 → 应自动换成新稿，且旧稿被存进快照。
 */
import path from 'node:path'
import os from 'node:os'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { findChromium } from '../browser-utils.mjs'

const BASE = (process.argv[2] ?? 'http://127.0.0.1:8099').replace(/\/$/, '')
const JSON_FILE = path.resolve((process.argv[3] ?? 'var/import-out/src-raw.json').replace(/^~/, os.homedir()))
const DOC_KEY = 'paiban-editor-doc-v1'
const SNAP_KEY = 'paiban-doc-snapshots-v1'

const raw = await readFile(JSON_FILE, 'utf8')
const doc = JSON.parse(raw)
const mark = `PUSH-TEST-${Date.now()}`

const executablePath = await findChromium()
const browser = await chromium.launch({ executablePath, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

const fail = (msg) => {
  console.log('✗ ' + msg)
  process.exitCode = 1
}

// 1) 干净打开：无本地存档，应从服务器拉
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.evaluate(([k, s]) => {
  localStorage.removeItem(k)
  localStorage.removeItem(s)
  localStorage.removeItem('paiban-push-seen-v1')
}, [DOC_KEY, SNAP_KEY])
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__paibanApi, null, { timeout: 20000 })
await new Promise((r) => setTimeout(r, 1200))
const firstPages = await page.evaluate(() => window.__paibanApi.doc.pages.length)
const hasLocal1 = await page.evaluate((k) => localStorage.getItem(k) !== null, DOC_KEY)
console.log(`· 首开：${firstPages} 页，已落本地存档=${hasLocal1}`)
if (!hasLocal1) fail('首开没从服务器拉到 doc')

// 2) 模拟用户微调：塞一份带标记的本地稿
await page.evaluate(
  ([k, tag]) => {
    const cur = JSON.parse(localStorage.getItem(k))
    cur.pages[0].els.push({
      id: tag,
      kind: 'text',
      variant: 'paragraph',
      html: `<p>${tag}</p>`,
      x: 45,
      y: 100,
      w: 400,
      h: 24,
      z: 30,
      autoHeight: true,
    })
    localStorage.setItem(k, JSON.stringify(cur))
  },
  [DOC_KEY, mark],
)

// 3) 外部推送新稿（带 ?push=1）
const res = await fetch(`${BASE}/api/doc?push=1`, {
  method: 'PUT',
  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  body: raw,
})
const putJson = await res.json().catch(() => ({}))
console.log(`· 推送：HTTP ${res.status} ${JSON.stringify(putJson)}`)
if (!putJson.ok) fail('推送失败')

// 4) 刷新：应自动载入推送稿，且本地那份微调进了快照
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__paibanApi, null, { timeout: 20000 })
await new Promise((r) => setTimeout(r, 1500))

const after = await page.evaluate(
  ([k, s, tag]) => {
    const rawLocal = localStorage.getItem(k) ?? ''
    const snaps = JSON.parse(localStorage.getItem(s) ?? '{"list":[]}').list ?? []
    return {
      pages: window.__paibanApi.doc.pages.length,
      stillLocalMark: rawLocal.includes(tag),
      snapCount: snaps.length,
      snapHasMark: snaps.some((x) => String(x.raw || '').includes(tag)),
      seen: localStorage.getItem('paiban-push-seen-v1'),
    }
  },
  [DOC_KEY, SNAP_KEY, mark],
)

console.log(`· 刷新后：${after.pages} 页（推送稿 ${doc.pages.length} 页）`)
console.log(`  本地稿里还留着微调标记：${after.stillLocalMark}（应为 false）`)
console.log(`  快照份数：${after.snapCount}，含被替换的微调稿：${after.snapHasMark}（应为 true）`)
console.log(`  已消费推送时间戳：${after.seen}`)

if (after.pages !== doc.pages.length) fail('页数与推送稿不一致，可能没载入')
if (after.stillLocalMark) fail('本地微调稿没被推送稿替换')
if (!after.snapHasMark) fail('被替换的本地稿没有进快照，用户无法反悔')

// 5) 再刷新一次：不应重复载入（同一份推送只消费一次）
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__paibanApi, null, { timeout: 20000 })
await new Promise((r) => setTimeout(r, 1000))
const again = await page.evaluate(() => window.__paibanApi.doc.pages.length)
console.log(`· 二次刷新：${again} 页（应仍为 ${doc.pages.length}）`)

await browser.close()
console.log(process.exitCode ? '\n链路有问题，看上面 ✗' : '\n✓ 链路正常：推送 → 刷新即见，旧稿可回溯')
