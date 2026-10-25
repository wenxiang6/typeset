/**
 * 图片地址解析：
 * - 网络图片 http(s)://…、data:、blob: 原样使用
 * - 开发环境：本地磁盘路径走 Vite 的 /@local 代理
 * - 单文件 / file:// 环境：本地路径直接用 file://，public 路径改成相对路径
 * - public 目录（/images/…）在 http 下原样使用
 */
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
      const pathname = decodeURIComponent(new URL(s).pathname)
      return toLocal(pathname)
    } catch {
      return s
    }
  }

  // 系统绝对路径（macOS / Linux）
  if (/^\/(Users|home|Volumes)\//.test(s)) {
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
  return s.startsWith('file://') || /^\/(Users|home|Volumes)\//.test(s)
}
