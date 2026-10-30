#!/usr/bin/env node
/**
 * 语义版面 JSON → 编辑器 doc（纯 Node，毫秒级，不需要浏览器）。
 *
 *   # 只校验（给 AI 自查用）
 *   node tools/layout/index.mjs 稿子.blocks.json --validate
 *
 *   # 生成 doc 存盘
 *   node tools/layout/index.mjs 稿子.blocks.json -o var/issue2/doc.json
 *
 *   # 生成并直接推到服务器（前端刷新就能看到）
 *   node tools/layout/index.mjs 稿子.blocks.json --post
 *   node tools/layout/index.mjs 稿子.blocks.json --post=http://127.0.0.1:9705
 *
 * 设计：AI 只写「内容 + 类型」，坐标由 geometry.mjs 算。
 * 推送到 /api/elements 时连坐标都不传，服务端自己排（这样规则升级，旧稿也受益）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeLayout, validateLayout } from './schema.mjs'
import { buildDoc } from './geometry.mjs'

export const DEFAULT_BASE = 'http://47.253.176.114:9705'

/** 语义 JSON（对象或字符串）→ { ok, doc, report, warnings } */
export function layoutSemantic(input, opts = {}) {
  const { layout, warnings } = normalizeLayout(input)
  if (!layout) return { ok: false, errors: warnings, doc: null, report: null, layout: null }
  const { doc, report } = buildDoc(layout, opts)
  return { ok: true, doc, report, layout, warnings: [...warnings, ...report.warnings] }
}

/** 推送语义 JSON 到服务端（服务端排版并落库，push=1 让前端自动载入） */
export async function postElements(base, layout, timeout = 30000, cred = null) {
  const url = `${base.replace(/\/$/, '')}/api/elements${cred ? `?u=${encodeURIComponent(cred.u)}&k=${cred.k}` : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(layout),
    signal: AbortSignal.timeout(timeout),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* 非 JSON 响应，保留原文 */
  }
  return { ok: res.ok, status: res.status, json, text }
}

/** 兜底：推送排好的 doc 原文到 /api/doc?push=1 */
export async function postDoc(base, doc, timeout = 30000, cred = null) {
  const q = cred ? `&u=${encodeURIComponent(cred.u)}&k=${cred.k}` : ''
  const url = `${base.replace(/\/$/, '')}/api/doc?push=1${q}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(doc),
    signal: AbortSignal.timeout(timeout),
  })
  return { ok: res.ok, status: res.status, text: await res.text() }
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

const isCli = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCli) {
  const argv = process.argv.slice(2)
  const input = argv.find((a) => !a.startsWith('-'))
  const opt = (name) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
    if (!hit) return undefined
    return hit.includes('=') ? hit.split('=').slice(1).join('=') : ''
  }
  const has = (name) => argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`))

  if (!input) {
    console.error(`用法: node tools/layout/index.mjs <稿子.blocks.json> [-o out.json] [--validate] [--post[=baseUrl]]
       node tools/layout/index.mjs 稿子.json --post              # 推到默认服务器
       node tools/layout/index.mjs 稿子.json -o out.json         # 只生成本地 doc`)
    process.exit(1)
  }

  const raw = await fs.readFile(path.resolve(input.replace(/^~/, process.env.HOME ?? '')), 'utf8')

  if (has('validate')) {
    const res = validateLayout(raw)
    console.log(JSON.stringify(res, null, 2))
    process.exit(res.ok ? 0 : 1)
  }

  const { ok, errors, doc, report, layout, warnings } = layoutSemantic(raw)
  if (!ok || !doc) {
    console.error('✗ 语义 JSON 有问题：')
    for (const e of errors ?? []) console.error('  -', e)
    process.exit(1)
  }

  for (const w of warnings ?? []) console.log(' !', w)

  console.log(
    `\n版式 A4 ${doc.orientation === 'portrait' ? '竖版' : '横版'} · ${report.pages} 页 · ${report.blocks} 个语义块 → ${report.elements} 个组件 · 正文 ${report.chars} 汉字`,
  )
  console.table(
    report.fill.map((f) => ({
      页: f.page,
      块: f.blocks,
      内容底部: f.bottom,
      左栏: `${f.fillLeft}%`,
      右栏: `${f.fillRight}%`,
      平均: `${f.fill}%`,
    })),
  )

  const oIdx = argv.findIndex((a) => a === '-o' || a === '--out')
  const out = oIdx >= 0 ? argv[oIdx + 1] : undefined
  if (out) {
    const file = path.resolve(out)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(doc, null, 2), 'utf8')
    console.log(`· 已写出 ${file}（${(JSON.stringify(doc).length / 1024).toFixed(0)} KB）`)
  }

  if (has('post')) {
    const base = opt('post') || process.env.PAIBAN_BASE || DEFAULT_BASE
    process.stdout.write(`· 推送到 ${base} … `)
    try {
      const res = await postElements(base, layout)
      if (res.ok) {
        console.log('成功（刷新网页即可看到）')
        if (res.json?.report) {
          const r = res.json.report
          console.log(`  服务端排版：${r.pages} 页 / ${r.elements} 组件 / 正文 ${r.chars} 汉字`)
        }
      } else {
        console.log(`失败（HTTP ${res.status}）`)
        // 老服务端没有 /api/elements：本地排好推 doc 原文
        if (res.status === 404) {
          process.stdout.write('· 服务端无 /api/elements，改为推送排好的 doc … ')
          const fb = await postDoc(base, doc)
          console.log(fb.ok ? '成功' : `失败（HTTP ${fb.status}）`)
        } else {
          console.log(res.text.slice(0, 300))
        }
      }
    } catch (err) {
      console.log(`连不上：${err.message}`)
      process.exitCode = 1
    }
  }
}
