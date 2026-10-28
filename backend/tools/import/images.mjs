/**
 * 从 .doc 里提取内嵌图片。
 *
 * Word .doc 把图片以「Blip」记录存在 Data 流中，图片数据本身仍是完整的
 * PNG / JPEG / EMF 字节流。这里不解析 Blip 记录结构，直接按文件签名定位、
 * 用格式自身的结束标记截断，再用结构校验过滤伪命中（头部碰巧相同的片段）。
 */
import { openCdf } from './ole.mjs'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff])
const EMF_SIG = Buffer.from([0x20, 0x45, 0x4d, 0x46]) // " EMF"
const EOI = Buffer.from([0xff, 0xd9])

/** PNG：逐 chunk 走到 IEND，顺带读出 IHDR 的宽高 */
function pngAt(buf, i) {
  if (buf.toString('latin1', i + 12, i + 16) !== 'IHDR') return null
  let p = i + 8
  for (let guard = 0; guard < 8192; guard++) {
    if (p + 8 > buf.length) return null
    const len = buf.readUInt32BE(p)
    const type = buf.toString('latin1', p + 4, p + 8)
    const end = p + 12 + len
    if (end > buf.length) return null
    if (type === 'IEND') {
      return { start: i, end, width: buf.readUInt32BE(i + 16), height: buf.readUInt32BE(i + 20), mime: 'image/png' }
    }
    p = end
  }
  return null
}

/** JPEG：按段解析到 SOS，再找 EOI */
function jpegAt(buf, i) {
  let p = i + 2
  for (let guard = 0; guard < 8192; guard++) {
    if (p + 4 > buf.length) return null
    if (buf[p] !== 0xff) return null
    const marker = buf[p + 1]
    if (marker === 0xd9) return { start: i, end: p + 2, width: 0, height: 0, mime: 'image/jpeg' }
    if (marker >= 0xd0 && marker <= 0xd7) {
      p += 2
      continue
    }
    if (marker === 0xda) {
      const end = buf.indexOf(EOI, p)
      if (end < 0) return null
      const dim = jpegSize(buf, i)
      return { start: i, end: end + 2, width: dim.w, height: dim.h, mime: 'image/jpeg' }
    }
    const len = buf.readUInt16BE(p + 2)
    if (len < 2) return null
    p += 2 + len
  }
  return null
}

function jpegSize(buf, i) {
  let p = i + 2
  for (let guard = 0; guard < 8192; guard++) {
    if (buf[p] !== 0xff) break
    const marker = buf[p + 1]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) }
    }
    if (marker === 0xda) break
    const len = buf.readUInt16BE(p + 2)
    if (len < 2) break
    p += 2 + len
  }
  return { w: 0, h: 0 }
}

/** EMF：头部 type=1 且偏移 40 处是 " EMF"，rclBounds 给出像素边界 */
function emfAt(buf, i) {
  if (i < 0 || i + 88 > buf.length) return null
  if (buf.readUInt32LE(i) !== 1) return null
  if (buf.readUInt32LE(i + 40) !== 0x464d4520) return null
  const size = buf.readUInt32LE(i + 48)
  if (size < 88 || i + size > buf.length) return null
  const left = buf.readInt32LE(i + 8)
  const top = buf.readInt32LE(i + 12)
  const right = buf.readInt32LE(i + 16)
  const bottom = buf.readInt32LE(i + 20)
  return {
    start: i,
    end: i + size,
    width: Math.max(1, right - left + 1),
    height: Math.max(1, bottom - top + 1),
    mime: 'image/emf',
  }
}

const MIN_BYTES = 2048
const MIN_PIXELS = 10000

function collect(buf, hits) {
  const push = (hit) => {
    if (!hit) return false
    const bytes = hit.end - hit.start
    if (bytes >= MIN_BYTES && hit.width * hit.height >= MIN_PIXELS) {
      hits.push({ mime: hit.mime, data: buf.subarray(hit.start, hit.end), width: hit.width, height: hit.height })
    }
    return true
  }

  for (let i = buf.indexOf(PNG_SIG); i >= 0; ) {
    const hit = pngAt(buf, i)
    push(hit)
    i = buf.indexOf(PNG_SIG, hit ? hit.end : i + 1)
  }

  for (let i = buf.indexOf(JPEG_SIG); i >= 0; ) {
    const hit = jpegAt(buf, i)
    push(hit)
    i = buf.indexOf(JPEG_SIG, hit ? hit.end : i + 1)
  }

  for (let i = buf.indexOf(EMF_SIG); i >= 0; ) {
    push(emfAt(buf, i - 40))
    i = buf.indexOf(EMF_SIG, i + 4)
  }

  return hits
}

/** 扫描任意二进制块里的图片（纯函数，便于单测） */
export function scanImages(buf) {
  if (!buf || !buf.length) return []
  const hits = collect(buf, [])
  const seen = new Set()
  return hits.filter((img) => {
    const key = `${img.data.length}:${img.width}x${img.height}:${img.data.subarray(0, 32).toString('base64')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 从 .doc 提取全部图片。取不到就返回空数组，由调用方降级成占位框。
 * @param {Buffer} buf
 */
export function extractDocImages(buf) {
  let cdf
  try {
    cdf = openCdf(buf)
  } catch {
    return []
  }
  const out = []
  for (const name of ['Data', 'WordDocument']) {
    const stream = cdf.stream(name)
    if (!stream) continue
    for (const img of scanImages(stream)) out.push({ ...img, from: name })
  }
  return out
}
