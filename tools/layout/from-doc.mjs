#!/usr/bin/env node
/**
 * 反向工具：已有版面 doc → 语义 JSON。
 *
 *   node tools/layout/from-doc.mjs var/issue1/out2.json -o var/issue1/blocks.json
 *
 * 两个用途：
 * 1. 回归：把老稿子转成语义稿再排一遍，比对页数/组件数/字数，确认语义层没丢东西；
 * 2. 示例：转出来的 JSON 就是给 AI 看的 few-shot 范本（真实稿子长什么样）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const argv = process.argv.slice(2)
const input = argv.find((a) => !a.startsWith('-'))
const oIdx = argv.findIndex((a) => a === '-o' || a === '--out')
if (!input) {
  console.error('用法: node tools/layout/from-doc.mjs <doc.json> [-o blocks.json]')
  process.exit(1)
}
const out = path.resolve(oIdx >= 0 ? argv[oIdx + 1] : input.replace(/\.json$/, '.blocks.json'))

const doc = JSON.parse(await fs.readFile(path.resolve(input), 'utf8'))
const FURN = new Set(['header', 'masthead', 'footer'])

const plain = (h) => String(h ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
const pick = (html, re) => re.exec(String(html ?? ''))?.[1]?.trim() ?? ''

/* —— 元信息：从页眉 / 报头 / 页脚里抠 —— */
const firstEls = doc.pages[0]?.els ?? []
const header = firstEls.find((e) => e.variant === 'header')?.html ?? ''
const masthead = firstEls.find((e) => e.variant === 'masthead')?.html ?? ''
const footer = firstEls.find((e) => e.variant === 'footer')?.html ?? ''

const meta = {
  journal: pick(header, /<div class="header-title">([^<]*)/) || '地理时政周刊',
  en: pick(header, /<span>([^<]*)<\/span>/) || 'GEO WEEKLY',
  kicker: pick(masthead, /<div class="kicker">([^<]*)</),
  title: pick(masthead, /<h1>([^<]*)<\/h1>/),
  sub: pick(masthead, /<div class="sub">([^<]*)</),
  issue: pick(header, /<div class="issue">([^<]*)</),
  date: pick(header, /<div class="issue">[^<]*<\/div><div>([^<]*)<\/div>/) ,
  editor: pick(footer, /编辑：([^<]*)/),
  proofreader: pick(footer, /核对：([^<]*)/),
  sloganLeft: pick(footer, /<div class="footer-top"><span>([^<]*)</),
  watermark: doc.watermark?.text ?? '',
}

/* —— 正文：按「页 → 栏 → 上到下」还原阅读顺序 —— */
const colOf = (el, pageW) => (el.x + el.w / 2 < pageW / 2 ? 0 : 1)

const blocks = []
for (const page of doc.pages) {
  const content = page.els.filter((e) => !FURN.has(e.variant) && !e.background && e.kind !== 'region')
  const ordered = [...content].sort((a, b) => colOf(a, doc.w) - colOf(b, doc.w) || a.y - b.y)
  for (const el of ordered) {
    const html = el.html ?? ''
    switch (el.variant) {
      case 'section-title':
      case 'subhead':
      case 'note':
      case 'concept':
      case 'trap':
      case 'req':
      case 'chain':
      case 'tpl':
      case 'quiz':
      case 'name-row':
        blocks.push({ type: el.variant === 'section-title' ? 'section' : el.variant, html })
        break
      case 'paragraph':
        blocks.push({ type: /class="w-lead"/.test(html) ? 'lead' : 'para', html })
        break
      case 'ulist':
      case 'olist':
        blocks.push({ type: 'list', html })
        break
      case 'table':
        blocks.push({ type: 'table', html })
        break
      case 'image':
        blocks.push({ type: 'image', src: el.src ?? '', ratio: el.w / Math.max(1, el.h), caption: '' })
        break
      default:
        blocks.push({ type: 'para', html })
    }
  }
}

const layout = { version: 1, orientation: doc.orientation ?? 'landscape', meta, blocks }
await fs.mkdir(path.dirname(out), { recursive: true })
await fs.writeFile(out, JSON.stringify(layout, null, 2), 'utf8')

const cn = (s) => (String(s).match(/[\u4e00-\u9fa5]/g) ?? []).length
console.log(`✓ ${blocks.length} 个语义块 → ${out}`)
console.log(`  原文 ${doc.pages.length} 页 / ${doc.pages.reduce((n, p) => n + p.els.length, 0)} 组件`)
console.log(`  正文汉字 ${cn(blocks.map((b) => b.html ?? '').join(''))}（不含页眉页脚）`)
