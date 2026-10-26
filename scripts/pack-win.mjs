#!/usr/bin/env node
/**
 * 打 Windows 免安装绿色包（在 macOS / Linux 上也能跑，不需要 Wine）
 *
 * electron-builder 打 win 安装版要靠 Wine 改 exe 图标/版本信息，本机没装 Wine 就会失败。
 * 这里走另一条路：直接下载官方 electron 的 win32-x64 压缩包，把我们的 app 塞进
 * resources/app，改名 exe，再打包成 zip。产物是「解压即用」的目录，不是安装程序，
 * 但功能完全一样（首次运行会自动建 userData 目录）。
 *
 *   node scripts/pack-win.mjs             # x64
 *   node scripts/pack-win.mjs --arm64     # Windows on ARM
 *
 * 想要带图标、带开始菜单快捷方式的正式安装包，在 Windows 机器上跑 `pnpm dist:win`。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const MIRROR = (process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/').replace(/\/?$/, '/')

const arch = process.argv.includes('--arm64') ? 'arm64' : 'x64'
const APP_NAME = '地理周刊排版'

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const electronVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8'),
).version

const releaseDir = path.join(ROOT, 'release')
const stageDir = path.join(releaseDir, `win-${arch}-unpacked`)
const zipName = `${APP_NAME}-${pkg.version}-win-${arch}-portable.zip`
const cacheDir = path.join(os.homedir(), '.cache', 'paiban-electron')
const zipCache = path.join(cacheDir, `electron-v${electronVersion}-win32-${arch}.zip`)

function log(msg) {
  console.log(msg)
}

async function download(url, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true })
  if (fs.existsSync(dest) && fs.statSync(dest).size > 50 * 1024 * 1024) {
    log(`· 复用已下载的 Electron：${dest}`)
    return
  }
  log(`· 下载 ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}：${url}`)
  const total = Number(res.headers.get('content-length') || 0)
  const chunks = []
  let got = 0
  let lastPct = -10
  for await (const chunk of res.body) {
    chunks.push(chunk)
    got += chunk.length
    if (total) {
      const pct = Math.round((got / total) * 100)
      if (pct - lastPct >= 10) {
        lastPct = pct
        log(`  ${pct}%  ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`)
      }
    }
  }
  await fsp.writeFile(dest, Buffer.concat(chunks))
  log(`· 已保存 ${(got / 1048576).toFixed(1)} MB`)
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('缺少 dist/index.html，请先执行 pnpm build')
  }

  await download(`${MIRROR}${electronVersion}/electron-v${electronVersion}-win32-${arch}.zip`, zipCache)

  await fsp.rm(stageDir, { recursive: true, force: true })
  await fsp.mkdir(stageDir, { recursive: true })
  log('· 解压 Electron 运行时')
  execFileSync('unzip', ['-q', '-o', zipCache, '-d', stageDir], { stdio: 'inherit' })

  // resources/app：Electron 会优先加载 app.asar，其次是 app 目录
  const appDir = path.join(stageDir, 'resources', 'app')
  await fsp.rm(appDir, { recursive: true, force: true })
  await fsp.mkdir(appDir, { recursive: true })
  for (const item of ['electron', 'dist', 'package.json']) {
    await fsp.cp(path.join(ROOT, item), path.join(appDir, item), { recursive: true })
  }
  await fsp.cp(path.join(ROOT, 'tools', 'import'), path.join(appDir, 'tools', 'import'), { recursive: true })
  // 只留运行时需要的，开发用的脚本/工具不带走
  for (const junk of [path.join(appDir, 'package.json')]) {
    const p = JSON.parse(await fsp.readFile(junk, 'utf8'))
    delete p.scripts
    delete p.devDependencies
    delete p.build
    await fsp.writeFile(junk, JSON.stringify(p, null, 2))
  }
  await fsp.rm(path.join(stageDir, 'resources', 'default_app.asar'), { force: true })

  const exeSrc = path.join(stageDir, 'electron.exe')
  const exeDst = path.join(stageDir, `${APP_NAME}.exe`)
  if (fs.existsSync(exeSrc)) await fsp.rename(exeSrc, exeDst)

  await fsp.writeFile(
    path.join(stageDir, '使用说明.txt'),
    `${APP_NAME} ${pkg.version}（Windows ${arch} 免安装版）\r\n\r\n` +
      `双击「${APP_NAME}.exe」即可使用，不需要安装。\r\n` +
      `建议把整个文件夹放到固定位置（例如 D:\\${APP_NAME}），不要只拷贝 exe。\r\n\r\n` +
      `导入 Word 原稿需要本机装有 Word / WPS / LibreOffice 之一：\r\n` +
      `程序会依次尝试 LibreOffice、Word、WPS 把 .doc/.docx 转成 HTML。\r\n` +
      `都没有时，先用 Word 把原稿「另存为 .docx」，或装个免费的 LibreOffice。\r\n\r\n` +
      `你的版面存档、导入的图片放在：\r\n%APPDATA%\\${APP_NAME}\\  \r\n`,
    'utf8',
  )

  log('· 打包 zip')
  const zipPath = path.join(releaseDir, zipName)
  await fsp.rm(zipPath, { force: true })
  execFileSync('zip', ['-qry', zipPath, path.basename(stageDir)], { cwd: releaseDir, stdio: 'inherit' })

  const size = (fs.statSync(zipPath).size / 1048576).toFixed(1)
  log(`\n✓ Windows 免安装包：${zipPath}（${size} MB）`)
  log('  解压后双击「' + APP_NAME + '.exe」即可；不装任何东西。')
}

main().catch((err) => {
  console.error('\n✗ 打包失败：', err.message)
  process.exit(1)
})
