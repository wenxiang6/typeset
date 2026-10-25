/**
 * 构建后处理：把 Vite 产出的 JS / CSS 全部内联进 index.html。
 *
 * 目的：dist/index.html 可以直接双击（file://）打开，不再依赖 HTTP 服务器，
 * 也不会出现 “/assets/xxx.js 被 CORS 拦截 → 白屏” 的问题。
 *
 * 用法：pnpm build  （package.json 已串上本脚本）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const indexPath = path.join(dist, 'index.html')

function toLocalPath(href) {
  const clean = href.split('?')[0].split('#')[0].replace(/^\.?\//, '')
  return path.join(dist, clean)
}

async function readAsset(href) {
  try {
    return await fs.readFile(toLocalPath(href), 'utf8')
  } catch {
    return null
  }
}

/** 防止内联脚本里出现 </script> 截断 */
function escapeScript(code) {
  return code.replace(/<\/script/gi, '<\\/script')
}

let html = await fs.readFile(indexPath, 'utf8')
let inlinedCss = 0
let inlinedJs = 0

// 1) 内联样式表；同时移除 crossorigin 以避免 file:// 下的无谓请求
const linkRe = /<link\b[^>]*rel="stylesheet"[^>]*>/gi
const links = [...html.matchAll(linkRe)]
for (const m of links) {
  const tag = m[0]
  const href = tag.match(/href="([^"]+)"/)?.[1]
  if (!href) continue
  const css = await readAsset(href)
  if (css == null) continue
  // 用函数替换，避免 CSS/JS 里的 $& $' 等被 String.replace 当成替换语法
  html = html.replace(tag, () => `<style data-inlined-from="${href}">\n${css}\n</style>`)
  inlinedCss++
}

// 2) 移除 modulepreload（脚本已内联，预加载没有意义，file:// 下还会报错）
html = html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>\s*/gi, '')

// 3) 内联入口 module 脚本（保留 type="module"，内联模块在 file:// 下可执行）
const scriptRe = /<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>\s*<\/script>/gi
const scripts = [...html.matchAll(scriptRe)]
for (const m of scripts) {
  const [tag, src] = m
  const js = await readAsset(src)
  if (js == null) continue
  html = html.replace(tag, () => `<script type="module">\n${escapeScript(js)}\n</script>`)
  inlinedJs++
}

// 4) 标注 + 写回；再复制一份中文文件名，方便直接找到并双击
const note = `<!-- 单文件构建：CSS/JS 已内联，可直接双击打开；由 scripts/inline-build.mjs 生成 -->\n`
if (!html.startsWith('<!--')) html = note + html
await fs.writeFile(indexPath, html, 'utf8')
await fs.copyFile(indexPath, path.join(dist, '地理周刊-排版编辑器.html'))

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)
console.log(`✓ 单文件构建完成：dist/index.html（${kb} KB，内联 CSS ${inlinedCss} 个 / JS ${inlinedJs} 个）`)
console.log(`✓ 可直接双击：dist/地理周刊-排版编辑器.html`)
if (inlinedJs === 0 || inlinedCss === 0) {
  console.warn('⚠ 没有内联到脚本或样式，请检查 vite base 与构建产物结构')
}
