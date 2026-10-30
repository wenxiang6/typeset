/**
 * 稿件图片压缩（sharp，装不上时自动降级为原图）。
 *
 * 规则：
 * - 小于 MIN_COMPRESS_BYTES 的图不动（压缩比不划算）
 * - 超宽图缩到 MAX_WIDTH，不放大
 * - 统一转 webp（质量 82），转完比原图还大就放弃，保原图
 * - sharp 缺失/出错一律保原图，绝不因为压缩失败把稿子搞挂
 */

let sharpMod = undefined

async function getSharp() {
  if (sharpMod !== undefined) return sharpMod
  try {
    sharpMod = (await import('sharp')).default
  } catch {
    sharpMod = null
  }
  return sharpMod
}

export const MIN_COMPRESS_BYTES = 300 * 1024
export const MAX_WIDTH = 1600

/** @returns {{ data: Buffer, ext: string } | null} null 表示保持原图 */
export async function compressImage(buf) {
  if (!buf || buf.length < MIN_COMPRESS_BYTES) return null
  const sharp = await getSharp()
  if (!sharp) return null
  try {
    const out = await sharp(buf)
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer()
    if (out.length > 0 && out.length < buf.length) return { data: out, ext: 'webp' }
  } catch {
    /* 坏图/不支持的格式：保原图 */
  }
  return null
}
