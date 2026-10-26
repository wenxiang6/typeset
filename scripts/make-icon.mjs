#!/usr/bin/env node
/**
 * 生成应用图标 build/icon.png（1024×1024）
 *
 * 不引第三方图形库：按像素画出来再手写 PNG（zlib 是 Node 自带的）。
 * electron-builder 会把这张 PNG 自动转成 macOS 的 .icns 和 Windows 的 .ico。
 *
 * 图形：深绿圆角底 + 米白「报头」横条 + 双栏文字块 + 红色强调线，
 * 缩到 32px 也能看出是「报纸/排版」。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SIZE = 1024
const SS = 2 // 超采样倍数，边缘更干净
const W = SIZE * SS

const GREEN = [22, 86, 58]
const CREAM = [246, 242, 231]
const RED = [192, 57, 43]

const canvas = new Float32Array(W * W * 4) // 0..1 预乘前的 alpha 混合用简单覆盖即可

function over(x, y, rgb, alpha = 1) {
  if (x < 0 || y < 0 || x >= W || y >= W) return
  const i = (y * W + x) * 4
  const a = alpha
  for (let c = 0; c < 3; c++) canvas[i + c] = canvas[i + c] * (1 - a) + (rgb[c] / 255) * a
  canvas[i + 3] = canvas[i + 3] * (1 - a) + a
}

/** 圆角矩形（含抗锯齿边缘） */
function roundRect(x0, y0, x1, y1, r, rgb) {
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const dx = Math.max(x0 + r - x - 0.5, 0, x + 0.5 - (x1 - r))
      const dy = Math.max(y0 + r - y - 0.5, 0, y + 0.5 - (y1 - r))
      const d = Math.hypot(dx, dy)
      const cov = Math.min(1, Math.max(0, r - d + 0.5))
      if (cov > 0) over(x, y, rgb, cov)
    }
  }
}

// 背景（留 4% 边距，符合 macOS 图标网格）
const pad = SIZE * SS * 0.045
roundRect(pad, pad, W - pad, W - pad, SIZE * SS * 0.225, GREEN)

const u = SIZE * SS / 1024 // 1 单位 = 1024 设计稿的 1px

/** 文字线（圆头） */
const line = (x, y, w, h, rgb = CREAM) => roundRect(x * u, y * u, (x + w) * u, (y + h) * u, (h / 2) * u, rgb)

// 报头：一条粗米白 + 下方红色细线
line(150, 190, 724, 74, CREAM)
line(150, 292, 300, 26, RED)

// 左栏 5 行
const leftRows = [
  [150, 396, 320],
  [150, 456, 320],
  [150, 516, 320],
  [150, 576, 240],
  [150, 636, 320],
  [150, 696, 180],
]
for (const [x, y, w] of leftRows) line(x, y, w, 30)

// 右栏 6 行（错开，像两栏流）
const rightRows = [
  [554, 396, 320],
  [554, 456, 320],
  [554, 516, 210],
  [554, 576, 320],
  [554, 636, 320],
  [554, 696, 260],
]
for (const [x, y, w] of rightRows) line(x, y, w, 30)

// 底部压一条通栏，收住视觉
line(150, 786, 724, 30, CREAM)

/* ---------------- 降采样 + PNG 编码 ---------------- */

const out = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4
        r += canvas[i]
        g += canvas[i + 1]
        b += canvas[i + 2]
        a += canvas[i + 3]
      }
    }
    const n = SS * SS
    const o = (y * SIZE + x) * 4
    const alpha = a / n
    // 还原为「非预乘」颜色
    out[o] = alpha > 0 ? Math.round((r / n / alpha) * 255) : 0
    out[o + 1] = alpha > 0 ? Math.round((g / n / alpha) * 255) : 0
    out[o + 2] = alpha > 0 ? Math.round((b / n / alpha) * 255) : 0
    out[o + 3] = Math.round(alpha * 255)
  }
}

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0 // filter: None
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const dir = path.resolve('build')
mkdirSync(dir, { recursive: true })
const file = path.join(dir, 'icon.png')
writeFileSync(file, png)
console.log(`✓ 图标已生成：${file}（${SIZE}×${SIZE}，${(png.length / 1024).toFixed(1)} KB）`)
