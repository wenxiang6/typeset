/**
 * 本地图片 → 内联 dataUrl（给 MCP / CLI 用）。
 *
 * 语义 JSON 里的图片有两种写法：
 *   { "type":"image", "src":"/images/imported/a.png" }   —— 服务器上已存在的文件
 *   { "type":"image", "src":"local:/Users/me/a.png" }    —— 本机文件，提交时自动转 dataUrl
 *
 * 转成 dataUrl 之后由服务端落盘并把 src 改写成可访问路径，
 * 所以 AI 不需要先想办法把图片传到服务器上。
 */
import fs from 'node:fs'
import path from 'node:path'

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

/** 读图片宽高（只解析文件头，不依赖任何三方库） */
export function probeImage(buf) {
  // PNG：IHDR 的宽高在 16 / 20
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  // GIF
  const head6 = buf.toString('ascii', 0, 6)
  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return { mime: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  // JPEG：扫 SOF 段
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++
        continue
      }
      const marker = buf[off + 1]
      const len = buf.readUInt16BE(off + 2)
      // SOF0..SOF3 / SOF5..SOF7 / SOF9..SOF11 / SOF13..SOF15
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { mime: 'image/jpeg', height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) }
      }
      if (len <= 0) break
      off += 2 + len
    }
    return { mime: 'image/jpeg', width: 0, height: 0 }
  }
  // BMP
  if (buf.length > 26 && buf.toString('ascii', 0, 2) === 'BM') {
    return { mime: 'image/bmp', width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) }
  }
  return { mime: MIME_BY_EXT[path.extname('').toLowerCase()] ?? 'image/png', width: 0, height: 0 }
}

/** 本地路径 → { dataUrl, width, height, ratio, bytes } */
export function imageToDataUrl(file) {
  const abs = path.resolve(String(file).replace(/^~/, process.env.HOME ?? ''))
  const buf = fs.readFileSync(abs)
  const meta = probeImage(buf)
  const mime = meta.mime || MIME_BY_EXT[path.extname(abs).toLowerCase()] || 'image/png'
  const width = meta.width || 0
  const height = meta.height || 0
  return {
    path: abs,
    src: `local:${abs}`,
    dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
    mime,
    width,
    height,
    ratio: width && height ? Math.round((width / height) * 1000) / 1000 : 1.6,
    bytes: buf.length,
  }
}

/**
 * 就地把 layout 里 src 以 local: 开头的图片换成 dataUrl。
 * @returns {{ resolved:number, warnings:string[] }}
 */
export function resolveLocalImages(layout) {
  const warnings = []
  let resolved = 0
  for (const b of layout?.blocks ?? []) {
    if (b.type !== 'image' || !b.src) continue
    if (!String(b.src).startsWith('local:')) continue
    const file = String(b.src).slice(6)
    try {
      const img = imageToDataUrl(file)
      b.src = ''
      b.dataUrl = img.dataUrl
      if (!b.ratio && img.ratio) b.ratio = img.ratio
      resolved++
      if (img.bytes > 4 * 1024 * 1024) warnings.push(`图片 ${path.basename(file)} 有 ${(img.bytes / 1048576).toFixed(1)}MB，提交会比较慢`)
      if (!img.width) warnings.push(`图片 ${path.basename(file)} 解析不出宽高，ratio 用了默认值`)
    } catch (err) {
      warnings.push(`图片读取失败 ${file}：${err?.message || err}`)
    }
  }
  return { resolved, warnings }
}
