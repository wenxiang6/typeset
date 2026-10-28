/**
 * 本地图片 → 压缩后的 dataURL。
 *
 * 直接把原图 base64 塞进文档的问题：一张 2MB 照片 ≈ 2.7M 字符，
 * 插三张就把 localStorage 的 5MB 配额吃光（快照历史被挤掉、自动保存失败），
 * 而且每次 doc 变动都要 stringify 一遍超大字符串，编辑会卡。
 * 这里统一降采样：最长边 ≤1600px、JPEG 质量 0.85，通常能压到 1/10。
 */

/** 小于这个体积的图不值得重绘（还可能损失画质），直接用原图 */
const PASS_THROUGH_BYTES = 600 * 1024

export interface CompactOptions {
  /** 最长边上限，默认 1600 */
  maxEdge?: number
  /** JPEG 质量，默认 0.85 */
  quality?: number
}

function readAsDataURL(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })
}

/** 有透明通道的格式保持原格式导出，避免白底盖掉透明 */
function keepsAlpha(type: string) {
  return type === 'image/png' || type === 'image/gif' || type === 'image/webp' || type === 'image/svg+xml'
}

export async function fileToCompactDataURL(file: File, opts: CompactOptions = {}): Promise<string> {
  const maxEdge = opts.maxEdge ?? 1600
  const quality = opts.quality ?? 0.85
  const original = await readAsDataURL(file)

  if (file.size <= PASS_THROUGH_BYTES) return original

  try {
    const img = await loadImage(original)
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) return original

    const scale = Math.min(1, maxEdge / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    // png/webp 保透明；jpeg 一律转（无透明可言）
    const mime = keepsAlpha(file.type) ? file.type : 'image/jpeg'
    const out = canvas.toDataURL(mime, quality)
    // 重绘结果反而更大（少见但可能）：退回原图，至少不亏
    return out.length < original.length ? out : original
  } catch {
    return original
  }
}
