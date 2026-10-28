#!/usr/bin/env node
/**
 * Word / 纯文本原稿 → 版面 JSON（网页版「导入 JSON」直接可用）
 *
 *   node tools/import/to-json.mjs 原稿.doc
 *   node tools/import/to-json.mjs 原稿.docx -o out/第二期.json --portrait
 *   node tools/import/to-json.mjs 原稿.doc --issue=第三期 --date=2026.11.04
 *   node tools/import/to-json.mjs 原稿.doc --word        # 走原来的「Word 按钮」链路
 *
 * 两种取元素的方式：
 *   默认   —— Node 端解析 + 规则识别（含纯文本稿兜底），不依赖 Word 样式
 *   --word —— 复用页面上的真实导入按钮，由 /@doc-import 服务端解析
 *
 * 布局必须回浏览器：量高、分栏、避让、溢出翻页、按行切割都在 layout.ts 里，
 * 脱离 DOM 算不出真实坐标。所以这里只负责「内容 → 组件」，坐标交给编辑器。
 */
import path from 'node:path'
import os from 'node:os'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { ensureServer, launchBrowser, closeBrowser, openEditor, waitSettled, sleep } from '../browser-utils.mjs'
import { parseDocFile } from './parse.mjs'
import { buildElements } from './rules.mjs'
import { extractDocImages } from './images.mjs'

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('-')))
const positional = argv.filter((a) => !a.startsWith('-') && !argv.some((a2, i) => (a2 === '-o' || a2 === '--out') && argv[i + 1] === a))
const input = positional[0]
if (!input) {
  console.error(`用法: node tools/import/to-json.mjs <file.doc|docx> [-o out.json] [--portrait] [--split|--merge]
       [--split-quiz=420] [--shots=dir] [--issue=第三期] [--date=2026.11.04] [--editor=曹明环] [--proofreader=何文静]`)
  process.exit(1)
}

const src = path.resolve(input.replace(/^~/, os.homedir()))
const oIdx = argv.findIndex((a) => a === '-o' || a === '--out')
const out = path.resolve(
  (oIdx >= 0 ? argv[oIdx + 1] : null) ?? path.join(path.dirname(src), `${path.basename(src, path.extname(src))}.paiban.json`),
)
const portrait = flags.has('--portrait')
const useWordBtn = flags.has('--word')
const merge = flags.has('--split') ? 'split' : flags.has('--merge') ? 'merge' : 'merge'
const opt = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')

const buf = await readFile(src)
const { blocks, html: srcHtml } = await parseDocFile(src)
const images = extractDocImages(buf).map((img, i) => ({
  ...img,
  url: `/images/imported/doc-img-${i + 1}.${img.mime.split('/')[1]}`,
}))

// 图片必须真落盘：/images/imported/xxx 是对外访问路径，文件不存在编辑器里就是破图。
// （之前这里只打了一句警告，等于每份带图的稿子都是坏图）
if (images.length) {
  const imgDir = path.resolve('public/images/imported')
  await mkdir(imgDir, { recursive: true })
  for (const img of images) {
    await writeFile(path.join(imgDir, path.basename(img.url)), img.data)
  }
  console.log(`· 已导出 ${images.length} 张内嵌图片 → ${imgDir}`)
}

let payload
if (useWordBtn) {
  payload = null // 走页面按钮，见下
} else {
  // 综合大题默认不切（整块 620px 反而能占满一栏）；要更细的块用 --split-quiz=420/260
  const quizSplit = Number(opt('split-quiz') ?? 9999)
  const built = buildElements(blocks, { images, quizSplit, lead: !flags.has('--no-lead') })
  payload = {
    ok: true,
    elements: built.elements,
    masthead: built.masthead,
    header: built.header,
    footer: built.footer,
    warnings: built.warnings,
    paragraphs: blocks.length,
  }
  console.log(`· 解析 ${path.basename(src)}：${blocks.length} 段，识别 ${built.elements.length} 个组件`)
}

const { started } = await ensureServer()
if (started) console.log('· 已启动本地服务')
const { browser } = await launchBrowser()
const { page, logs } = await openEditor(browser)

let result
if (useWordBtn) {
  await page.click('.ed-tb-word')
  await page.waitForSelector('.ed-word-pop', { timeout: 8000 })
  if (portrait) await page.locator('.ed-word-pop button', { hasText: '竖版' }).click()
  await page.click('.ed-word-pop .ed-word-go')
  await page.setInputFiles('input[accept*=".doc"]', src)
  await page.waitForFunction(() => {
    const api = window.__paibanApi
    const busy = document.querySelector('.ed-tb-word')?.textContent?.includes('解析中')
    return !!api && api.doc.pages.length >= 1 && !busy
  }, null, { timeout: 60000 })
  await dismissNotice(page)
  await waitSettled(page)
  result = { warnings: [] }
} else {
  result = await page.evaluate(
    async ({ payload, orientation, mergeMode }) => {
      const api = window.__paibanApi
      if (!api) throw new Error('编辑器未挂载')
      if (typeof window.__paibanImport !== 'function') throw new Error('window.__paibanImport 不存在，页面版本过旧')
      // 字体没就绪时量出的行高偏小，分页会算少
      if (document.fonts?.ready) await document.fonts.ready
      const res = await window.__paibanImport(payload, { orientation, merge: mergeMode })
      api.importDoc(res.doc)
      // 等 reflow 把跨页切割做完，再读最终页数
      let prev = ''
      let same = 0
      for (let k = 0; k < 60; k++) {
        await new Promise((r) => setTimeout(r, 60))
        const sig = JSON.stringify(api.doc.pages.map((p) => p.els.map((e) => [e.id, Math.round(e.y), Math.round(e.h)])))
        if (sig === prev) {
          if (++same >= 2) break
        } else {
          prev = sig
          same = 0
        }
      }
      return { pages: api.doc.pages.length, warnings: res.warnings ?? [] }
    },
    { payload, orientation: portrait ? 'portrait' : 'landscape', mergeMode: merge },
  )
  console.log(`· 排版完成：${result.pages} 页（合并策略 ${merge}）`)
  await waitSettled(page)
}

const doc = await page.evaluate(() => JSON.parse(JSON.stringify(window.__paibanApi.doc)))

// 页眉页脚覆盖（期数 / 日期 / 编辑 / 核对）
const issue = opt('issue')
const date = opt('date')
const editor = opt('editor')
const proofs = opt('proofreader')
const journal = opt('journal')
const watermark = opt('watermark')
if (issue || date || editor || proofs || journal) {
  await page.evaluate(
    ({ issue, date, editor, proofs, journal }) => {
      const api = window.__paibanApi
      const doc = JSON.parse(JSON.stringify(api.doc))
      for (const p of doc.pages)
        for (const el of p.els) {
          if (el.variant === 'header') {
            if (journal)
              el.html = el.html.replace(
                /(<div class="header-title">)[^<]*(\s*<span>)/,
                `$1${journal}$2`,
              )
            if (issue) el.html = el.html.replace(/(<div class="issue">)[^<]*(<\/div>)/, `$1${issue}$2`)
            if (date) el.html = el.html.replace(/(<div class="issue">[^<]*<\/div><div>)[^<]*(<\/div>)/, `$1${date}$2`)
          }
          if (el.variant === 'footer') {
            if (editor) el.html = el.html.replace(/编辑：[^<]*/, `编辑：${editor}`)
            if (proofs) el.html = el.html.replace(/核对：[^<]*/, `核对：${proofs}`)
          }
        }
      api.importDoc(doc)
    },
    { issue, date, editor, proofs, journal },
  )
  await sleep(200)
  Object.assign(doc, await page.evaluate(() => JSON.parse(JSON.stringify(window.__paibanApi.doc))))
}

if (watermark && doc.watermark) {
  doc.watermark = { ...doc.watermark, text: watermark }
}

await mkdir(path.dirname(out), { recursive: true })
await writeFile(out, JSON.stringify(doc, null, 2), 'utf8')

const stats = doc.pages.map((p, i) => ({
  页: i + 1,
  元素: p.els.filter((e) => !['header', 'footer', 'masthead'].includes(e.variant)).length,
  内容底部: Math.round(p.els.reduce((m, e) => Math.max(m, e.y + e.h), 0)),
}))
const cnt = {}
doc.pages.forEach((p) => p.els.forEach((e) => (cnt[e.variant] = (cnt[e.variant] || 0) + 1)))
const warnings = [...(payload?.warnings ?? []), ...(result?.warnings ?? [])]

console.log(`\n版式 ${doc.orientation === 'portrait' ? 'A4 竖版' : 'A4 横版'} ${doc.w}×${doc.h} · ${doc.pages.length} 页`)
console.table(stats)
console.log('组件:', JSON.stringify(cnt))
if (images.length) console.log(`⚠ 本稿含 ${images.length} 张内嵌图片，需手动放到 public/images/imported/ 或双击占位框换图`)
for (const w of warnings) console.log(' !', w)
console.log(`\n已写出 ${out}  (${(JSON.stringify(doc).length / 1024).toFixed(0)} KB)`)

const errs = logs.filter((l) => l.type === 'pageerror')
if (errs.length) console.log('运行期错误:\n' + errs.map((e) => e.text).join('\n'))

// --shots=<dir> 逐页截图，检查版面
const shotDir = opt('shots')
if (shotDir) {
  await mkdir(path.resolve(shotDir), { recursive: true })
  for (let i = 0; i < doc.pages.length; i++) {
    await page.evaluate((idx) => {
      const node = document.querySelectorAll('.ed-page')[idx]
      const wrap = node?.closest('.ed-page-wrap')
      const scroller = document.querySelector('.ed-canvas-scroll')
      if (wrap && scroller) {
        scroller.scrollTop = wrap.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8
      }
    }, i)
    await sleep(250)
    const f = path.resolve(shotDir, `page-${i + 1}.png`)
    await page.locator('.ed-page').nth(i).screenshot({ path: f })
    console.log('· 截图', f)
  }
}

await closeBrowser()

async function dismissNotice(p) {
  const ok = p.locator('.ed-notice-foot button', { hasText: '知道了' })
  if (await ok.count()) await ok.click()
  await sleep(150)
}
