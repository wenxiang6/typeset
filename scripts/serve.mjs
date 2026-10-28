#!/usr/bin/env node
/**
 * 服务器部署用的 Node 服务（复用桌面版那一套 HTTP 层）。
 *
 * Word 解析不是纯前端能力：页面 POST /@doc-import，需要一个 Node 进程接住，
 * 再调用系统上的转换器（macOS textutil / LibreOffice / Word / WPS）转 HTML。
 * 所以 dist/ 的静态文件单独扔到 nginx / OSS / Pages 上，导入一定失败。
 *
 *   pnpm build                                   # 先出 dist
 *   pnpm serve --host 0.0.0.0 --port 8080
 *
 * 常用参数：
 *   --host <地址>        默认 127.0.0.1；要局域网/公网访问再写 0.0.0.0
 *   --port <端口>        默认 5173
 *   --dist <目录>        默认 dist
 *   --images-dir <目录>  导入图片落盘位置，默认 ./var/imported（别放 dist 里，构建会被覆盖）
 *   --no-local           关掉 /@local 磁盘代读（对外服务建议关）
 *   --check              只做环境体检，打印后退出，不启动服务
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { startServer } from '../electron/server.mjs'
import { converterReport } from '../tools/import/parse.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  const out = {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 5173),
    dist: path.join(root, 'dist'),
    imagesDir: path.join(root, 'var', 'imported'),
    allowLocal: true,
    check: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--check') out.check = true
    else if (a === '--no-local') out.allowLocal = false
    else if (a === '--host') out.host = argv[++i]
    else if (a === '--port') out.port = Number(argv[++i])
    else if (a === '--dist') out.dist = path.resolve(argv[++i])
    else if (a === '--images-dir') out.imagesDir = path.resolve(argv[++i])
    else if (a === '--help' || a === '-h') out.help = true
    else {
      console.error(`未知参数：${a}\n用法：pnpm serve --host 0.0.0.0 --port 8080 [--no-local]`)
      process.exit(2)
    }
  }
  return out
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('用法：pnpm serve [--host 0.0.0.0] [--port 8080] [--dist dist] [--images-dir var/imported] [--no-local] [--check]')
    return
  }

  /* —— 环境体检：能不能解析 Word，缺什么 —— */
  const report = await converterReport()
  console.log('\nWord 转换器体检')
  console.log('  平台       :', process.platform, process.arch)
  for (const c of report.available) console.log('   ✓', c)
  for (const c of report.missing) console.log('   ✗', c)
  if (!report.ok) {
    console.log('\n  ⚠️  没有可用转换器，导入 Word 会失败。挑一个装上：')
    console.log('     ', report.installHint)
    console.log('      装完重启本服务即可（不用重新 build）。')
  }

  if (args.check) return

  /* —— dist 就绪检查 —— */
  if (!fs.existsSync(path.join(args.dist, 'index.html'))) {
    console.error(`\n✗ 没有找到 ${path.join(args.dist, 'index.html')}\n  先跑一次 pnpm build，再 pnpm serve`)
    process.exit(1)
  }
  fs.mkdirSync(args.imagesDir, { recursive: true })
  fs.mkdirSync(os.tmpdir(), { recursive: true })

  const { url } = await startServer({
    distDir: args.dist,
    imagesDir: args.imagesDir,
    tmpDir: os.tmpdir(),
    host: args.host,
    port: args.port,
    allowLocal: args.allowLocal,
    log: (m) => console.log('  [err]', m),
  })

  console.log('\n已启动')
  console.log('  访问地址   :', url)
  console.log('  静态目录   :', args.dist)
  console.log('  导入图片   :', args.imagesDir)
  console.log('  Word 解析  :', report.ok ? `可用（${report.available.join(' / ')}）` : '不可用 —— 见上方安装提示')
  console.log('  本地磁盘代读:', args.allowLocal ? '开启（/@local）' : '已关闭')
  if (args.host !== '127.0.0.1' && args.host !== 'localhost') {
    console.log('\n  提示：对外监听时请自己加 HTTPS / 登录，本服务只做静态托管与 Word 解析，没有任何鉴权。')
  }
  console.log('\nCtrl+C 退出\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
