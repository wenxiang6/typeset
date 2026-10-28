/**
 * 纯 Node 排版：语义块 → 完整版面 doc（带坐标，可直接导入编辑器）。
 *
 * 和 src/editor/layout.ts 的关系：
 *   那边是「交互时」的排版内核（拖动避让、按行切割、跨页续块），跑在浏览器里；
 *   这边是「生成时」的一次性装箱，只求顺序、分栏、翻页大致正确，
 *   剩下的交给编辑器打开时的自动测量 + reflow 收口（doc.flow.autoHeight/autoPage = true）。
 *
 * 所以这里的几何常量必须和 layout.ts 对齐，改了那边记得同步：
 *   MARGIN 37.8 / COL_GAP 12 / PAGE_GAP 4 / FOOTER_OFFSET 45.4 / HEADER_TOP 30.2
 */
import { estimateHeight, VARIANT_STYLE, textWidth, splitLines, decodeEntities } from './style.mjs'
import { blockToEl, headerHtml, footerHtml, mastheadHtml } from './blocks.mjs'

export const A4 = {
  landscape: { w: 1122.52, h: 793.7 },
  portrait: { w: 793.7, h: 1122.52 },
}

export const MARGIN = 37.8
export const COL_GAP = 12
export const PAGE_GAP = 4
export const FOOTER_OFFSET = 45.4
export const HEADER_TOP = 30.2
export const HEADER_HEIGHT = 40
export const MASTHEAD_HEIGHT = 99
export const DOC_VERSION = 3

const FONT_STACK = '"Lantinghei SC","PingFang SC","Heiti SC","SimHei","Microsoft YaHei",sans-serif'

let seq = 0
function uid(prefix = 'el') {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

/** 报头高度：kicker / h1 / sub 三行 + 内边距（与 .masthead 的 CSS 对齐） */
export function estimateMasthead(meta) {
  let h = 20 // padding 10*2
  if (meta.kicker) h += 19.2 + 3
  h += 26.4 + 3 // h1 24px * 1.1
  h += 16.8 // sub 14px
  h += 8 // margin-bottom
  return Math.round(h)
}

/** 表格：按行数估算（单元格 12px/1.5 + padding 4*2 + border） */
function tableHeight(html) {
  const rows = (String(html).match(/<tr[\s>]/g) ?? []).length
  return Math.max(24, rows * (18 + 8 + 2))
}

/**
 * 生成版面。
 * @param {object} layout 已归一化的语义版面（见 schema.mjs）
 * @param {{ margin?: number }} [opts]
 * @returns {{ doc: object, report: object }}
 */
export function buildDoc(layout, opts = {}) {
  const warnings = []
  const meta = layout.meta
  const paper = A4[layout.orientation] ?? A4.landscape
  const pageW = paper.w
  const pageH = paper.h

  const left = MARGIN
  const right = pageW - MARGIN
  const width = right - left
  const colW = (width - COL_GAP) / 2
  const mastheadH = meta.masthead ? estimateMasthead(meta) : 0
  const topFirst = HEADER_TOP + HEADER_HEIGHT + 8 + (mastheadH ? mastheadH + 8 : 0)
  const topRest = HEADER_TOP + HEADER_HEIGHT + 8
  const bottom = pageH - FOOTER_OFFSET - 8
  const colHeight = bottom - topRest

  /* —— 组件：语义块 → 描述（不带坐标）—— */
  const descs = []
  for (const b of layout.blocks) {
    const el = blockToEl(b)
    if (!el) {
      warnings.push(`未知块类型 ${b.type}，已跳过`)
      continue
    }
    descs.push({ block: b, el })
  }
  if (!descs.length) warnings.push('没有可排的内容块')

  /* —— 页面与栏游标 —— */
  const pages = []
  let page = null
  let col = 0
  let z = 22

  const startPage = (isFirst) => {
    const els = []
    els.push({
      id: uid('el'),
      kind: 'chrome',
      variant: 'header',
      html: headerHtml(meta),
      x: left,
      y: HEADER_TOP,
      w: width,
      h: HEADER_HEIGHT,
      z: 20,
    })
    if (isFirst && mastheadH) {
      els.push({
        id: uid('el'),
        kind: 'chrome',
        variant: 'masthead',
        html: mastheadHtml(meta),
        x: left,
        y: HEADER_TOP + HEADER_HEIGHT + 8,
        w: width,
        h: mastheadH,
        z: 21,
      })
    }
    page = { id: uid('page'), els, cursors: [isFirst ? topFirst : topRest, isFirst ? topFirst : topRest] }
    pages.push(page)
    col = 0
  }

  const fits = (h, c) => page.cursors[c] + h <= bottom
  const contentOnPage = () => page.els.some((e) => e.kind !== 'chrome')

  startPage(true)

  for (const { block, el } of descs) {
    const full = el.full === true
    const w = full ? width : colW

    // 图片：按比例算高，宽高都不超出可用区域
    let h
    if (el.variant === 'image') {
      const ratio = el.ratio > 0 ? el.ratio : 1.6
      h = Math.round(w / ratio)
      const maxH = Math.round((bottom - topFirst) * 0.86)
      if (h > maxH) h = maxH
    } else if (el.variant === 'table') {
      h = tableHeight(el.html)
    } else {
      h = estimateHeight(el.html ?? '', el.variant, w)
    }

    if (full) {
      // 跨栏块：两栏对齐到较高者，占满整幅宽度
      let y = Math.max(page.cursors[0], page.cursors[1])
      if (y + h > bottom && contentOnPage()) {
        startPage(false)
        y = page.cursors[0]
      }
      if (h > bottom - y) {
        warnings.push(`${block.type} 跨栏块高 ${h}px 超过可用高度，已压缩（编辑器会再调）`)
        h = Math.max(60, Math.round(bottom - y))
      }
      page.els.push({
        id: uid('el'),
        kind: el.kind,
        variant: el.variant,
        html: el.html,
        src: el.src,
        x: left,
        y: Math.round(y * 10) / 10,
        w: Math.round(width * 10) / 10,
        h,
        z: z++,
        autoHeight: el.variant !== 'image',
      })
      page.cursors = [y + h + PAGE_GAP, y + h + PAGE_GAP]
      continue
    }

    /* 单栏块：当前栏放不下 → 右栏 → 翻页；都放不下说明块本身超高，压到栏高 */
    if (!fits(h, col)) {
      if (col === 0) col = 1
      else {
        startPage(false)
        col = 0
      }
    }
    if (!fits(h, col)) {
      if (contentOnPage()) {
        startPage(false)
        col = 0
      }
      if (h > colHeight) {
        warnings.push(`${block.type} 块高 ${h}px 超过栏高 ${Math.round(colHeight)}px，编辑器里会被自动切开`)
        h = Math.round(colHeight)
      }
    }

    const x = col === 0 ? left : left + colW + COL_GAP
    page.els.push({
      id: uid('el'),
      kind: el.kind,
      variant: el.variant,
      html: el.html,
      src: el.src,
      x: Math.round(x * 10) / 10,
      y: Math.round(page.cursors[col] * 10) / 10,
      w: Math.round(colW * 10) / 10,
      h,
      z: z++,
      autoHeight: el.variant !== 'image',
    })
    page.cursors[col] += h + PAGE_GAP
  }

  /* —— 末页均衡：最后一页只有左栏有内容时，把后半段挪到右栏 ——
   * 报纸收尾常见版式：内容不够填满两栏时左右分着排，比「左边满、右边空」好看得多。
   * 只搬 y 靠后的那一半，所以阅读顺序（左栏上→下，右栏上→下）不变。 */
  const last = pages[pages.length - 1]
  if (last) {
    const body = last.els.filter((e) => !['header', 'masthead', 'footer'].includes(e.variant))
    const leftBlocks = body.filter((e) => e.x < pageW / 2).sort((a, b) => a.y - b.y)
    const hasRight = body.some((e) => e.x >= pageW / 2)
    const totalH = leftBlocks.reduce((s, e) => s + e.h + PAGE_GAP, 0)
    if (!hasRight && leftBlocks.length >= 4 && totalH > (bottom - topRest) * 0.3) {
      let acc = 0
      let cut = leftBlocks.length
      for (let i = 0; i < leftBlocks.length; i++) {
        acc += leftBlocks[i].h + PAGE_GAP
        if (acc >= totalH / 2) {
          cut = i + 1
          break
        }
      }
      if (cut < leftBlocks.length) {
        const pageTop = last.els.some((e) => e.variant === 'masthead') ? topFirst : topRest
        let y = pageTop
        for (const e of leftBlocks.slice(cut)) {
          e.x = Math.round((left + colW + COL_GAP) * 10) / 10
          e.y = Math.round(y * 10) / 10
          y += e.h + PAGE_GAP
        }
        // 左栏重新压实（搬走的块留下的空洞）
        let ly = pageTop
        for (const e of leftBlocks.slice(0, cut)) {
          e.y = Math.round(ly * 10) / 10
          ly += e.h + PAGE_GAP
        }
        warnings.push(`末页内容不足两栏，已把后 ${leftBlocks.length - cut} 个块移到右栏`)
      }
    }
  }

  /* —— 页脚：页码按最终页数写死，前端 renumberPages 仍会再校一遍 —— */
  pages.forEach((p, i) => {
    p.els.push({
      id: uid('el'),
      kind: 'chrome',
      variant: 'footer',
      html: footerHtml(meta, i + 1, pages.length),
      x: left,
      y: Math.round((pageH - FOOTER_OFFSET) * 10) / 10,
      w: Math.round(width * 10) / 10,
      h: 37,
      z: 900,
      autoHeight: true,
    })
  })

  const doc = {
    version: DOC_VERSION,
    w: pageW,
    h: pageH,
    orientation: layout.orientation,
    margin: { top: HEADER_TOP, right: MARGIN, bottom: FOOTER_OFFSET, left: MARGIN },
    flow: { autoHeight: true, autoPage: true },
    watermark: {
      text: meta.watermark || [meta.journal, meta.editor, meta.proofreader].filter(Boolean).join(' · '),
      size: 14,
      opacity: 0.15,
      angle: -30,
    },
    defaults: { fontFamily: FONT_STACK, fontSize: '14px' },
    pages: pages.map((p) => ({ id: p.id, els: p.els })),
  }

  /* —— 体检报告：给 AI / 命令行看的排版质量 —— */
  const report = {
    pages: pages.length,
    elements: pages.reduce((n, p) => n + p.els.length, 0),
    blocks: descs.length,
    chars: countChars(doc),
    orientation: layout.orientation,
    colWidth: Math.round(colW * 10) / 10,
    /** 每页每栏单独算填充率，满页约 90%+；低于 55% 说明这页很空 */
    fill: pages.map((p, i) => {
      const top = i === 0 ? topFirst : topRest
      const content = p.els.filter((e) => !['header', 'masthead', 'footer'].includes(e.variant))
      const colMax = [0, 0]
      for (const e of content) {
        const c = e.x + e.w / 2 < pageW / 2 ? 0 : 1
        colMax[c] = Math.max(colMax[c], e.y + e.h)
      }
      const pct = (c) => (colMax[c] > 0 ? Math.min(100, Math.round(((colMax[c] - top) / (bottom - top)) * 100)) : 0)
      const bottomMost = content.length ? Math.max(...content.map((e) => e.y + e.h)) : 0
      return {
        page: i + 1,
        blocks: content.length,
        bottom: Math.round(bottomMost),
        fillLeft: pct(0),
        fillRight: pct(1),
        fill: Math.round((pct(0) + pct(1)) / 2),
      }
    }),
    warnings,
  }

  return { doc, report }
}

/** 统计汉字数（校验用：语义 JSON 的字数应和成稿一致；不含页眉页脚） */
export function countChars(doc) {
  const FURN = new Set(['header', 'masthead', 'footer'])
  let n = 0
  for (const p of doc.pages) {
    for (const el of p.els) {
      if (FURN.has(el.variant)) continue
      const text = String(el.html ?? '').replace(/<[^>]+>/g, '')
      n += (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
    }
  }
  return n
}

export { estimateHeight, VARIANT_STYLE, textWidth, splitLines, decodeEntities }
