/**
 * 图片地址解析：
 * - 网络图片 http(s)://…、data:、blob: 原样使用
 * - 开发环境：本地磁盘路径走 Vite 的 /@local 代理
 * - 单文件 / file:// 环境：本地路径直接用 file://，public 路径改成相对路径
 * - public 目录（/images/…）在 http 下原样使用
 */
/** Windows 盘符绝对路径：C:\Users\... / D:/素材/... */
const WIN_DRIVE = /^[A-Za-z]:[\\/]/

/** 系统绝对路径（macOS / Linux） */
const UNIX_ABS = /^\/(Users|home|Volumes|mnt|media|opt|srv|private)\//

export function resolveImageSrc(src?: string): string | undefined {
  const s = (src ?? '').trim()
  if (!s) return s
  if (/^(https?:|data:|blob:)/i.test(s)) return s

  const isFilePage = typeof window !== 'undefined' && window.location.protocol === 'file:'

  if (s.startsWith('/@local')) {
    // 旧存档里可能保存了解析后的地址；file:// 下无法再走代理
    if (isFilePage) return s.replace(/^\/@local/, '')
    return s
  }

  if (s.startsWith('file://')) {
    // 单文件版直接用 file://（同源协议下浏览器允许图片读取）
    if (isFilePage) return s
    try {
      const u = new URL(s)
      // Windows 的 file:///C:/... pathname 是 "/C:/..."，保留盘符段
      const pathname = decodeURIComponent(u.pathname)
      return toLocal(pathname)
    } catch {
      return s
    }
  }

  // Windows 盘符路径：统一斜杠后交给 /@local（桌面版代理按平台 normalize）
  if (WIN_DRIVE.test(s)) {
    const unified = s.replace(/\\/g, '/')
    if (isFilePage) return `file:///${encodeURI(unified)}`
    return toLocal(unified)
  }

  // 系统绝对路径（macOS / Linux）
  if (UNIX_ABS.test(s)) {
    if (isFilePage) return `file://${encodeURI(s)}`
    return toLocal(s)
  }

  // file:// 页面里的 /images/xxx 必须变成相对路径，否则会解析成 file:///images/xxx
  if (isFilePage && s.startsWith('/') && !s.startsWith('//')) return s.slice(1)

  return s
}

function toLocal(absPath: string) {
  return '/@local' + absPath.split('/').map(encodeURIComponent).join('/')
}

/** 是否是本地磁盘路径（用于提示用户） */
export function isLocalPath(src?: string): boolean {
  const s = (src ?? '').trim()
  return s.startsWith('file://') || UNIX_ABS.test(s) || WIN_DRIVE.test(s)
}
