/**
 * electron-builder afterPack 钩子：给 macOS 产物打 ad-hoc 签名
 *
 * 没有开发者证书时 electron-builder 会跳过签名，Apple Silicon 上未签名的 app
 * 会直接被系统拒绝启动。ad-hoc（`codesign -s -`）不需要证书，本机/同团队自用足够。
 * 对外分发想要「双击不报警」还是得用开发者 ID 证书 + 公证。
 */
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
    console.log(`· 已 ad-hoc 签名：${path.basename(appPath)}`)
  } catch (err) {
    console.warn(`· ad-hoc 签名失败（不影响本机使用）：${err.message}`)
  }
}
