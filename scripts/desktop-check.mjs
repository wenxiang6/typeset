#!/usr/bin/env node
/**
 * 桌面版自检：真的把 Electron 应用拉起来，检查窗口、导入、打印预览是否可用。
 *
 *   node scripts/desktop-check.mjs                     # 用本机 electron 跑开发目录
 *   node scripts/desktop-check.mjs --portrait          # 导入成竖版
 *   node scripts/desktop-check.mjs --exe <可执行文件>   # 校验打包后的产物
 *
 * 走的是 Playwright 的 Electron 驱动，和网页版 smoke 一样能读到 __paibanApi。
 */
import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const argv = process.argv.slice(2)
const wantPortrait = argv.includes('--portrait')
const exeIdx = argv.indexOf('--exe')
const exePath = exeIdx >= 0 ? path.resolve(argv[exeIdx + 1]) : null
const docPath = path.resolve('~/Desktop/docs/地理时政周刊一.doc'.replace(/^~/, os.homedir()))
const shotDir = path.join(ROOT, 'artifacts', 'desktop')
fs.mkdirSync(shotDir, { recursive: true })

// 有些环境（例如在 Electron 应用里跑脚本）会带 ELECTRON_RUN_AS_NODE=1，
// 那会让 electron 退化成普通 Node，require('electron') 拿到的是二进制路径而不是 API。
const env = { ...process.env, PAIBAN_CHECK: '1' }
delete env.ELECTRON_RUN_AS_NODE

const launched = await electron.launch({
  executablePath: exePath ?? path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
  // --no-sandbox：在受限沙箱环境（CI / agent 容器）里 Chromium 起不来，普通机器不需要
  args: exePath ? ['--no-sandbox'] : ['.', '--no-sandbox'],
  cwd: ROOT,
  env,
})

const logs = []
launched.process().stdout?.on('data', (b) => logs.push(String(b).trim()))
launched.process().stderr?.on('data', (b) => logs.push(String(b).trim()))

const page = await launched.firstWindow()
await page.waitForSelector('.ed-page', { timeout: 30_000 })

const info = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  pages: window.__paibanApi.doc.pages.length,
  size: `${window.__paibanApi.doc.w} × ${window.__paibanApi.doc.h}`,
  desktop: !!window.paibanDesktop,
  platform: window.paibanDesktop?.platform ?? null,
}))
console.log('窗口标题:', info.title)
console.log('本地服务:', info.url.replace(/\/$/, ''))
console.log('初始版面:', info.size, '|', info.pages, '页 | 预加载桥:', info.desktop, info.platform ?? '')

let failed = 0
const check = (ok, msg) => {
  console.log(`${ok ? '✓' : '✗'} ${msg}`)
  if (!ok) failed += 1
}

check(/^http:\/\/127\.0\.0\.1:\d+/.test(info.url), '页面通过本地服务加载（不是 file://）')
check(info.desktop === true, '预加载桥已注入（菜单快捷方式可用）')

// 导入 Word
if (fs.existsSync(docPath)) {
  await page.click('.ed-tb-word')
  await page.waitForSelector('.ed-word-pop', { timeout: 5000 })
  if (wantPortrait) await page.locator('.ed-word-pop button', { hasText: '竖版' }).click()
  await page.click('.ed-word-pop .ed-word-go')
  await page.setInputFiles('input[accept*=".doc"]', docPath)
  await page.waitForSelector('.ed-notice', { timeout: 60_000 })
  const notice = await page.evaluate(() => {
    const n = document.querySelector('.ed-notice')
    return {
      title: n?.querySelector('.ed-notice-title')?.textContent ?? '',
      stats: [...(n?.querySelectorAll('.ed-notice-stat') ?? [])].map((s) => s.textContent?.trim()),
    }
  })
  check(notice.title.includes('已导入'), `导入 Word：${notice.title}`)
  console.log('   ', notice.stats.join(' · '))
  await page.locator('.ed-notice-foot button', { hasText: '知道了' }).click()
  await new Promise((r) => setTimeout(r, 400))

  const after = await page.evaluate(() => {
    const d = window.__paibanApi.doc
    const ids = d.pages.flatMap((p) => p.els.map((e) => e.id))
    const imgs = d.pages.flatMap((p) => p.els.filter((e) => e.kind === 'image'))
    const broken = [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0)
    return { pages: d.pages.length, total: ids.length, images: imgs.length, broken: broken.length }
  })
  check(after.total > 20, `版面已重建：${after.pages} 页 / ${after.total} 个组件`)
  check(after.broken === 0, `图片全部可读（${after.images} 张，破图 ${after.broken}）`)
  await page.screenshot({ path: path.join(shotDir, 'after-import.png'), fullPage: false })
} else {
  console.log(`! 跳过导入测试（找不到 ${docPath}）`)
}

// 打印预览弹窗（桌面版里 iframe + srcdoc 是否照常工作）
await page.evaluate(() => document.querySelector('.ed-tb-print, .ed-print-trigger')?.click())
await new Promise((r) => setTimeout(r, 800))
const pv = await page.evaluate(() => {
  const host = document.getElementById('ed-print-preview')
  const frame = host?.querySelector('iframe')
  return { open: !!host, pages: frame?.contentDocument?.querySelectorAll('.ed-page-wrap').length ?? 0 }
})
check(pv.open && pv.pages > 0, `打印预览弹窗：${pv.pages} 页`)
await page.screenshot({ path: path.join(shotDir, 'print-preview.png') })

const errs = logs.filter((l) => /error|Error|失败/i.test(l))
if (errs.length) console.log('\n主进程输出：\n' + errs.slice(0, 10).join('\n'))
console.log(`\n${failed ? '✗' : '✓'} 桌面版自检：${failed ? `${failed} 项失败` : '全部通过'}`)

await launched.close()
process.exit(failed ? 1 : 0)
