#!/usr/bin/env node
/**
 * 高度估算校准：拿一份真实排好的 doc，逐个组件比对「估算 vs 实测」。
 *
 *   node tools/layout/calibrate.mjs var/issue1/out2.json
 *
 * 只统计文字/盒子类组件（页眉页脚报头是固定件，图片按比例算，不在此列）。
 */
import fs from 'node:fs'
import { estimateHeight } from './style.mjs'

const file = process.argv[2] ?? 'var/issue1/out2.json'
const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
const SKIP = new Set(['header', 'masthead', 'footer', 'image'])

const rows = []
for (const page of doc.pages) {
  for (const el of page.els) {
    if (SKIP.has(el.variant)) continue
    if (!el.html) continue
    const est = estimateHeight(el.html, el.variant, el.w)
    rows.push({ variant: el.variant, est, real: el.h, diff: est - el.h, pct: ((est - el.h) / Math.max(1, el.h)) * 100 })
  }
}

const byVariant = new Map()
for (const r of rows) {
  const a = byVariant.get(r.variant) ?? { n: 0, sumPct: 0, maxPct: 0, sumAbs: 0 }
  a.n++
  a.sumPct += r.pct
  a.sumAbs += Math.abs(r.diff)
  a.maxPct = Math.max(a.maxPct, Math.abs(r.pct))
  byVariant.set(r.variant, a)
}

console.log(`样本 ${rows.length} 个组件（${file}）\n`)
console.log('变体'.padEnd(16), '数量'.padStart(4), '平均偏差'.padStart(9), '平均绝对误差'.padStart(13), '最大偏差'.padStart(9))
for (const [v, a] of [...byVariant].sort((x, y) => y[1].n - x[1].n)) {
  console.log(
    v.padEnd(16),
    String(a.n).padStart(4),
    `${(a.sumPct / a.n).toFixed(1)}%`.padStart(9),
    `${(a.sumAbs / a.n).toFixed(1)}px`.padStart(13),
    `${a.maxPct.toFixed(0)}%`.padStart(9),
  )
}

const worst = [...rows].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 10)
console.log('\n偏差最大的 10 个：')
for (const r of worst) {
  console.log(` ${r.variant.padEnd(14)} 估算 ${String(r.est).padStart(4)} 实测 ${String(Math.round(r.real)).padStart(4)}  差 ${r.diff > 0 ? '+' : ''}${r.diff.toFixed(0)}px (${r.pct.toFixed(0)}%)`)
}

const overall = rows.reduce((s, r) => s + Math.abs(r.pct), 0) / Math.max(1, rows.length)
console.log(`\n整体平均绝对偏差 ${overall.toFixed(1)}%`)
process.exit(overall > 25 ? 1 : 0)
