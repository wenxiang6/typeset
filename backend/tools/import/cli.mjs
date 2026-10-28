#!/usr/bin/env node
/**
 * 调试用 CLI：把 .doc 解析成 blocks 并打印，验证规则表。
 *
 *   node tools/import/cli.mjs ~/Desktop/docs/地理时政周刊一.doc
 *   node tools/import/cli.mjs <doc> --json   输出完整 JSON（含图片 base64 长度）
 *   node tools/import/cli.mjs <doc> --save   把图片存到 public/images/imported/
 *   node tools/import/cli.mjs <doc> --split  短条目按拆分输出（默认合并）
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseDocFile } from './parse.mjs'
import { extractDocImages } from './images.mjs'
import { buildElements } from './rules.mjs'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('用法: node tools/import/cli.mjs <file.doc> [--json] [--save]')
  process.exit(1)
}
const wantJson = args.includes('--json')
const wantSave = args.includes('--save')
const wantSplit = args.includes('--split')
const abs = path.resolve(file.replace(/^~/, process.env.HOME))

const buf = await readFile(abs)
const started = Date.now()
const { blocks } = await parseDocFile(abs)
const images = extractDocImages(buf)
// 图片落盘后的访问路径（服务端导入时同样规则：public/images/imported/doc-img-N.ext）
const savedImages = images.map((img, i) => ({
  ...img,
  url: `/images/imported/doc-img-${i + 1}.${img.mime.split('/')[1]}`,
}))
const built = buildElements(blocks, { images: savedImages, merge: !wantSplit })

const ms = Date.now() - started

if (wantJson) {
  console.log(
    JSON.stringify(
      {
        masthead: built.masthead,
        header: built.header,
        footer: built.footer,
        elements: built.elements,
        warnings: built.warnings,
        images: images.map((i) => ({ mime: i.mime, width: i.width, height: i.height, bytes: i.data.length, from: i.from })),
      },
      null,
      2,
    ),
  )
} else {
  console.log(`\n文件: ${path.basename(abs)}  (${(buf.length / 1024).toFixed(0)} KB, ${ms}ms)`)
  console.log(`段落: ${blocks.length} 个（非空 ${blocks.filter((b) => !b.empty).length}）`)
  console.log(`图片: ${images.length} 张`)
  for (const img of images) {
    console.log(`  - ${img.mime} ${img.width}x${img.height} ${(img.data.length / 1024).toFixed(0)}KB @${img.from}`)
  }
  console.log(`\n识别出的元素: ${built.elements.length} 个`)
  const counts = {}
  for (const el of built.elements) counts[el.variant] = (counts[el.variant] || 0) + 1
  console.log('变体分布:', counts)
  const groups = built.elements.filter((el) => el.grp != null)
  if (groups.length) {
    console.log(`短条目组: ${new Set(groups.map((e) => e.grp)).size} 组`)
    for (const el of groups) {
      const parts = el.parts ? el.parts.length : 0
      console.log(`  grp${el.grp} ${el.variant} ${parts ? `合并 ${parts} 条` : '已拆分'}`)
    }
  }
  console.log('\n--- 元素列表 ---')
  built.elements.forEach((el, i) => {
    const preview = strip(el.html).slice(0, 56)
    const tag = el.grp != null ? ` ⟨组${el.grp}⟩` : ''
    console.log(`${String(i + 1).padStart(2, '0')} ${el.variant.padEnd(14)} ${preview}${tag}`)
  })
  if (built.warnings.length) {
    console.log('\n--- 警告 ---')
    for (const w of built.warnings) console.log(' !', w)
  }
}

if (wantSave && images.length) {
  const dir = path.resolve('public/images/imported')
  await mkdir(dir, { recursive: true })
  for (let i = 0; i < images.length; i++) {
    const ext = images[i].mime.split('/')[1]
    const name = `doc-img-${i + 1}.${ext}`
    await writeFile(path.join(dir, name), images[i].data)
    console.log(`saved ${dir}/${name}`)
  }
}

function strip(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
