/**
 * 纯 Node 的高度估算（不碰 DOM、不起浏览器）。
 *
 * 为什么需要它：语义 JSON 里没有坐标和高度，服务端要在毫秒级排出一版能看的报纸。
 * 这里按 CSS 里的真实数值（newspaper.css / editor.css）逐段算行数，
 * 误差控制在 ±10% 内，剩下的交给编辑器打开时的「自动测量 + 回流」收口。
 *
 * 数值来源（改样式时同步这里）：
 *   p            14px / 1.55 / margin-bottom 2      .ed-page p
 *   h3           14px / 1.5  / margin 4 0 2         .ed-page h3
 *   .section-title  h2 13px, .num 12px/1.3 + pad 1 6, 下边框 1, margin 4 0 3
 *   .note        13px / 1.5 / padding 5 8 / 左边框 3
 *   .concept-box 13px / 1.45 / padding 4 7 / 左边框 2
 *   .chain       13px / 1.6 / padding 5 8 / 边框 1
 *   .trap        13px / 1.5 / padding-left 4
 *   .req         13px / 1.6 / padding-left 2
 *   .tpl         边框 2 / padding 6 9；h4 14px；p 13px/1.5/margin-bottom 3
 *   .quiz        11px / 1.4 / padding 3 6；.exp 10px
 */

/** 各变体的默认排版参数 */
export const VARIANT_STYLE = {
  paragraph: { fs: 14, lh: 1.55, padX: 0, padY: 0, border: 0, paraGap: 2 },
  subhead: { fs: 14, lh: 1.5, padX: 0, padY: 0, border: 0, paraGap: 0 },
  lead: { fs: 16, lh: 1.7, padX: 10, padY: 2, border: 3, paraGap: 2 },
  'section-title': { fs: 13, lh: 1.3, padX: 0, padY: 2, border: 1, fixed: 23 },
  note: { fs: 13, lh: 1.5, padX: 8, padY: 5, border: 0, paraGap: 2 },
  concept: { fs: 13, lh: 1.45, padX: 7, padY: 4, border: 0, paraGap: 2 },
  chain: { fs: 13, lh: 1.6, padX: 8, padY: 5, border: 1, paraGap: 2 },
  trap: { fs: 13, lh: 1.5, padX: 4, padY: 0, border: 0, paraGap: 2 },
  req: { fs: 13, lh: 1.6, padX: 2, padY: 0, border: 0, paraGap: 2 },
  tpl: { fs: 13, lh: 1.5, padX: 9, padY: 6, border: 2, paraGap: 3 },
  /* 注意：`.ed-page p` 直接给 p 设了 14px/1.55，优先级高于 .quiz 自身的 11px 继承，
   * 所以 quiz 框里的段落实际是 14px（实测 142px 高才推得通）。只有 .exp 是 10px。 */
  quiz: { fs: 14, lh: 1.55, padX: 6, padY: 3, border: 0, paraGap: 2 },
  'name-row': { fs: 13, lh: 1.5, padX: 0, padY: 0, border: 0, fixed: 22 },
  image: { fs: 14, lh: 1.5, padX: 0, padY: 0, border: 0 },
  table: { fs: 12, lh: 1.5, padX: 6, padY: 4, border: 1 },
}

/** 一个字符的视觉宽度（em）：中日韩全角 1em，西文约 0.52em */
export function charWidth(ch) {
  const code = ch.codePointAt(0)
  if (code < 0x20) return 0
  if (code === 0x20) return 0.28
  // CJK 统一表意 / 全角标点 / 假名 / 谚文
  if (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0x3000 && code <= 0x303f)
  ) {
    return 1
  }
  // 数字比小写字母略宽
  if (code >= 0x30 && code <= 0x39) return 0.55
  // 大写字母偏宽
  if (code >= 0x41 && code <= 0x5a) return 0.62
  return 0.52
}

export function textWidth(text, fs) {
  let w = 0
  for (const ch of String(text ?? '')) w += charWidth(ch) * fs
  return w
}

const ESC = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'" }
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(amp|lt|gt|nbsp|quot|#39);/g, (m) => ESC[m] ?? m)
}

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'li', 'ul', 'ol', 'tr', 'table', 'section', 'br'])

/**
 * 把 html 切成「视觉行组」：每个组有文本、字号、行高、段后距。
 * 不追求完整 DOM 语义，只认块级边界 + 两个影响字号的东西（tpl 的 h4、quiz 的 .exp）。
 */
export function splitLines(html, variant) {
  const st = VARIANT_STYLE[variant] ?? VARIANT_STYLE.paragraph
  const out = []
  let buf = ''
  /** 当前块的字号覆盖（h4 = 14px） */
  let blockFs = null
  /** 当前行是否落在 .exp 里（quiz 解释文字小一号） */
  let inExp = false

  const flush = (gap) => {
    const text = decodeEntities(buf.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    buf = ''
    if (!text) return
    let fs = blockFs ?? (inExp && variant === 'quiz' ? 10 : st.fs)
    out.push({ text, fs, lh: st.lh, gap: gap ?? st.paraGap ?? 2 })
  }

  const re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|<br\s*\/?>|([^<]+)/g
  let m
  while ((m = re.exec(html)) !== null) {
    if (m[4] !== undefined) {
      buf += m[4]
      continue
    }
    const closing = !!m[1]
    const tag = String(m[2] ?? '').toLowerCase()
    const attrs = m[3] ?? ''
    if (!tag) continue // <br> 走上面的分支，这里兜底

    if (tag === 'br') {
      flush(0)
      continue
    }
    if (tag === 'span' || tag === 'b' || tag === 'strong' || tag === 'i' || tag === 'em') {
      if (tag === 'span') {
        const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? ''
        if (closing) inExp = false
        else if (/(^|\s)exp(\s|$)/.test(cls)) inExp = true
      }
      continue
    }
    if (!BLOCK_TAGS.has(tag)) continue

    flush()
    if (tag === 'h4' || tag === 'h3' || tag === 'h1' || tag === 'h2') {
      blockFs = closing ? null : 14
    }
    if (tag === 'p' || tag === 'div' || tag === 'li' || tag === 'tr') {
      if (closing) blockFs = null
    }
  }
  flush()
  return out
}

/**
 * 估算一个组件的自然高度。
 * @param {string} html 组件 html
 * @param {string} variant 组件变体
 * @param {number} width 组件宽度（px）
 */
export function estimateHeight(html, variant, width) {
  const st = VARIANT_STYLE[variant] ?? VARIANT_STYLE.paragraph
  if (st.fixed) {
    // 固定高度的条状组件（章节标题 / 姓名行）：fixed 就是单行的最终高度，超长再按行加
    const text = decodeEntities(String(html ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    const perLine = Math.max(6, Math.floor((width - st.padX * 2) / (st.fs * 1.05)))
    const lines = Math.max(1, Math.ceil(text.length / perLine))
    return Math.round(st.fixed + (lines - 1) * st.fs * st.lh)
  }

  const avail = Math.max(60, width - st.padX * 2 - st.border * 2)
  const lines = splitLines(html ?? '', variant)
  if (!lines.length) return Math.max(12, st.padY * 2 + st.border * 2)

  let h = 0
  lines.forEach((line, i) => {
    const lineHeight = line.fs * line.lh
    const w = textWidth(line.text, line.fs)
    const n = Math.max(1, Math.ceil((w * 1.02) / avail))
    h += n * lineHeight
    if (i < lines.length - 1) h += line.gap
  })
  return Math.round(h + st.padY * 2 + st.border * 2)
}

/** 给一个已带 variant/w/h 的元素估算高度（HTML 里只有内容） */
export function estimateElement(el, width) {
  return estimateHeight(el.html ?? '', el.variant ?? 'paragraph', width)
}
