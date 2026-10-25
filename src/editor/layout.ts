/**
 * 版面几何 / 自动避让 / 自动高度 / WPS 式分页内核（纯函数，方便测试）
 *
 * 坐标系：页面左上角为 (0,0)，单位 = CSS px（96dpi，A4 横向 1122.5 × 793.7）
 *
 * 关键概念
 * - 家具（furniture）：页眉 header / 报头 masthead / 页脚 footer，固定在页面，不参与流动
 * - 内容块（flowable）：正文、内容框、图片、分隔线、章节标题（chrome.section-title）
 * - 双栏：left / right；跨栏块（span）按整幅内容宽度处理
 * - 自动高度：文字块按真实内容高度伸缩，下方组件自动下推
 * - 自动分页：超出页底的内容块整体流到下一页顶部，并顺延后续页
 */
import type { Doc, DocPage, El, FlowConfig, Orientation } from './types'

export type Rect = { x: number; y: number; w: number; h: number }

export const A4 = {
  // A4 297×210mm / 210×297mm，96dpi 精确换算
  landscape: { w: 1122.52, h: 793.7 },
  portrait: { w: 793.7, h: 1122.52 },
} as const

export const MARGIN = 45.3 // 左右 12mm
export const COL_GAP = 14.1 // 栏间距 ~3.7mm
export const PAGE_GAP = 4 // 组件紧凑间距
/** 页脚距页面底部的默认距离（与初始模板一致） */
export const FOOTER_OFFSET = 60.5
/** 页眉起点与固定高度：正文起点不再跟随被拖动的报头 */
export const HEADER_TOP = 37.8
export const HEADER_HEIGHT = 34.8
export const MASTHEAD_HEIGHT = 86.6
export const DOC_VERSION = 3

const FURNITURE = new Set(['header', 'masthead', 'footer'])
const ORIENTATIONS: Orientation[] = ['landscape', 'portrait']

let seq = 0
export function uid(prefix = 'el') {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/* ------------------------------------------------------------------ *
 * 元素分类
 * ------------------------------------------------------------------ */

export function isFurniture(el: El): boolean {
  return el.kind === 'chrome' && FURNITURE.has(el.variant)
}

/** 会随内容流动/参与避让的元素（章节标题算内容，不算家具） */
export function isFlowable(el: El): boolean {
  if (el.kind === 'region') return false
  if (el.background) return false
  if (isFurniture(el)) return false
  return el.kind === 'text' || el.kind === 'box' || el.kind === 'image' || el.kind === 'line' || el.kind === 'chrome'
}

/** 需要测量真实文字高度的元素（页脚除外，它内部是绝对定位） */
export function isMeasurable(el: El): boolean {
  if (el.kind === 'text' || el.kind === 'box') return true
  return el.kind === 'chrome'
}

/* ------------------------------------------------------------------ *
 * 页面几何
 * ------------------------------------------------------------------ */

export interface PageGeom {
  pageW: number
  pageH: number
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
  colW: number
  gap: number
  cols: [number, number]
}

export function getGeometry(doc: Doc, pageIdx: number): PageGeom {
  const els = doc.pages[pageIdx]?.els ?? []
  const left = MARGIN
  const right = Math.max(left + 160, doc.w - MARGIN)
  const width = right - left
  const colW = Math.max(40, (width - COL_GAP) / 2)

  const header = els.find((e) => isFurniture(e) && e.variant === 'header')
  const masthead = els.find((e) => isFurniture(e) && e.variant === 'masthead')
  // 版心起点只跟随页眉/报头的“高度”，不跟随它们的拖动位置：
  // 报头文字变多时自动下推正文；拖动报头不会清空页面。
  const headerH = header?.h ?? HEADER_HEIGHT
  const mastheadH = masthead?.h ?? MASTHEAD_HEIGHT
  const top = HEADER_TOP + headerH + 8 + (masthead ? mastheadH + 8 : 0)
  const bottom = Math.max(top + 80, doc.h - FOOTER_OFFSET - 8)

  return {
    pageW: doc.w,
    pageH: doc.h,
    left,
    right,
    top,
    bottom,
    width,
    height: bottom - top,
    colW,
    gap: COL_GAP,
    cols: [left, left + colW + COL_GAP],
  }
}

export function columnOf(geom: PageGeom, el: Pick<El, 'x' | 'w'>): 0 | 1 | 'span' {
  if (el.w > geom.colW * 1.45) return 'span'
  return el.x + el.w / 2 < (geom.left + geom.right) / 2 ? 0 : 1
}

export function columnX(geom: PageGeom, col: 0 | 1 | 'span'): number {
  return col === 'span' ? geom.left : geom.cols[col]
}

/* ------------------------------------------------------------------ *
 * 区域约束（原有功能）
 * ------------------------------------------------------------------ */

export function findRegion(doc: Doc, pageIdx: number, rect: Rect, ignoreId?: string): El | null {
  const els = doc.pages[pageIdx]?.els ?? []
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  return (
    els.find(
      (e) =>
        e.kind === 'region' &&
        e.id !== ignoreId &&
        cx >= e.x &&
        cx <= e.x + e.w &&
        cy >= e.y &&
        cy <= e.y + e.h,
    ) ?? null
  )
}

export function clampRect(rect: Rect, region: Rect): Rect {
  const w = Math.min(rect.w, region.w)
  const h = Math.min(rect.h, region.h)
  return {
    ...rect,
    w,
    h,
    x: Math.min(Math.max(rect.x, region.x), region.x + region.w - w),
    y: Math.min(Math.max(rect.y, region.y), region.y + region.h - h),
  }
}

export function clampToRegion(doc: Doc, pageIdx: number, rect: Rect, ignoreId?: string): Rect {
  const region = findRegion(doc, pageIdx, rect, ignoreId)
  return region ? clampRect(rect, region) : rect
}

/* ------------------------------------------------------------------ *
 * 拖动时的边界
 * ------------------------------------------------------------------ */

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max)
}

/**
 * 拖动/缩放时的约束：
 * - 左右不出版心
 * - 向上不钻到报头/页眉下面
 * - 下边界放宽到整页底部，允许“拖出页底 → 松手自动移到下一页”
 */
export function clampDragRect(doc: Doc, pageIdx: number, rect: Rect, region?: Rect | null): Rect {
  const g = getGeometry(doc, pageIdx)
  const w = Math.max(8, rect.w)
  const h = Math.max(8, rect.h)
  let out: Rect = {
    ...rect,
    w,
    h,
    x: clamp(rect.x, g.left, Math.max(g.left, g.right - w)),
    y: clamp(rect.y, g.top, Math.max(g.top, g.pageH - h)),
  }
  if (region) out = clampRect(out, region)
  return out
}

/** 新建/数值输入时的约束：必须完整落在版心内 */
export function clampContentRect(doc: Doc, pageIdx: number, rect: Rect): Rect {
  const g = getGeometry(doc, pageIdx)
  const w = Math.min(Math.max(8, rect.w), g.width)
  const h = Math.min(Math.max(8, rect.h), g.height)
  return {
    ...rect,
    w,
    h,
    x: clamp(rect.x, g.left, Math.max(g.left, g.right - w)),
    y: clamp(rect.y, g.top, Math.max(g.top, g.bottom - h)),
  }
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function hOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - 0.5 && a.x + a.w > b.x + 0.5
}

/* ------------------------------------------------------------------ *
 * 自动避让：把与拖动元素重叠的内容沿“空间最小 + 拖动方向优先”推开
 * ------------------------------------------------------------------ */

export interface MoveResolution {
  rect: Rect
  pushed: Map<string, Rect>
  /** 被锁定/顶到边界而无法让开的元素（用于 UI 提示） */
  blocked: string[]
}

type Dir = 'up' | 'down' | 'left' | 'right'

function dirDelta(dir: Dir, cur: Rect, other: Rect): number {
  if (dir === 'down') return cur.y + cur.h - other.y + PAGE_GAP
  if (dir === 'up') return cur.y - (other.y + other.h) - PAGE_GAP
  if (dir === 'right') return cur.x + cur.w - other.x + PAGE_GAP
  return cur.x - (other.x + other.w) - PAGE_GAP
}

function applyDir(dir: Dir, other: Rect, delta: number): Rect {
  if (dir === 'down') return { ...other, y: other.y + delta }
  if (dir === 'up') return { ...other, y: other.y + delta }
  if (dir === 'right') return { ...other, x: other.x + delta }
  return { ...other, x: other.x + delta }
}

function pushOut(
  doc: Doc,
  pageIdx: number,
  cur: Rect,
  other: Rect,
  dragAxis: 'x' | 'y',
  dragSign: number,
  region: Rect | null,
): Rect | null {
  const natural: Dir =
    Math.abs(cur.y + cur.h / 2 - (other.y + other.h / 2)) >=
    Math.abs(cur.x + cur.w / 2 - (other.x + other.w / 2))
      ? other.y + other.h / 2 >= cur.y + cur.h / 2
        ? 'down'
        : 'up'
      : other.x + other.w / 2 >= cur.x + cur.w / 2
        ? 'right'
        : 'left'
  const preferred: Dir = dragAxis === 'x' ? (dragSign >= 0 ? 'right' : 'left') : dragSign >= 0 ? 'down' : 'up'
  const dirs: Dir[] = [preferred, natural, preferred === 'down' || preferred === 'up' ? 'right' : 'down', preferred === 'down' || preferred === 'up' ? 'left' : 'up']
  const tried = new Set<Dir>()

  for (const dir of dirs) {
    if (tried.has(dir)) continue
    tried.add(dir)
    const delta = dirDelta(dir, cur, other)
    if (delta <= 0) continue // 该方向已经错开，不需要推
    let next = applyDir(dir, other, delta)
    // 推动后仍必须在版心 / 自己的栏 / 自身区域内
    const g = getGeometry(doc, pageIdx)
    const col = columnOf(g, other)
    const minX = col === 'span' ? g.left : g.cols[col]
    const maxX = col === 'span' ? g.right - next.w : Math.max(minX, g.cols[col] + g.colW - next.w)
    next = {
      ...next,
      x: clamp(next.x, minX, maxX),
      y: clamp(next.y, g.top, Math.max(g.top, g.pageH - next.h)),
    }
    if (region) next = clampRect(next, region)
    if (overlaps(cur, next)) {
      // 被边界顶住了，试试其它方向
      continue
    }
    return next
  }
  return null
}

/**
 * 拖动计算：返回被推动元素的新位置。
 * 只沿“拖动方向 / 空间最小方向”推开，不会出现旧版那种一路把上方元素
 * 反向推到报头底下的级联；实在推不动时保留重叠并标记 blocked。
 */
export function resolveMove(
  doc: Doc,
  pageIdx: number,
  movingId: string,
  desired: Rect,
  prev: Rect,
  anchorRegion: Rect | null = null,
): MoveResolution {
  const els = doc.pages[pageIdx]?.els ?? []
  const moving = els.find((e) => e.id === movingId)
  const pushed = new Map<string, Rect>()
  const blocked: string[] = []
  if (!moving || !isFlowable(moving)) {
    const rect = moving ? clampDragRect(doc, pageIdx, desired, anchorRegion) : desired
    // 页眉/报头/页脚是页面固定件：限制在自己的页边区域内，
    // 不允许拖进正文区造成“整页内容被挤走”
    if (moving && isFurniture(moving)) {
      const g = getGeometry(doc, pageIdx)
      let y = rect.y
      if (moving.variant === 'footer') {
        y = clamp(y, g.bottom + 4, Math.max(g.bottom + 4, doc.h - rect.h))
      } else {
        y = clamp(y, 0, Math.max(0, g.top - rect.h - 4))
      }
      return { rect: { ...rect, y }, pushed, blocked }
    }
    return { rect, pushed, blocked }
  }

  // 锁定元素是实心障碍：即便拖到它上面也不允许盖住
  const lockedHit = els.some((e) => e.locked && e.id !== movingId && isFlowable(e) && overlaps(desired, e))
  if (lockedHit) return { rect: prev, pushed, blocked }

  const rect = clampDragRect(doc, pageIdx, desired, anchorRegion)
  const dx = rect.x - prev.x
  const dy = rect.y - prev.y
  const dragAxis: 'x' | 'y' = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
  const dragSign = dragAxis === 'x' ? Math.sign(dx) : Math.sign(dy)

  const queue: Array<{ id: string; rect: Rect }> = [{ id: movingId, rect }]
  const queued = new Set<string>([movingId])
  let guard = 0

  while (queue.length && guard++ < 500) {
    const cur = queue.shift()
    if (!cur) break
    for (const other of els) {
      if (other.id === cur.id || other.id === movingId) continue
      if (!isFlowable(other) || other.locked || other.background) continue
      const otherRect = pushed.get(other.id) ?? { x: other.x, y: other.y, w: other.w, h: other.h }
      if (!overlaps(cur.rect, otherRect)) continue
      const region = findRegion(doc, pageIdx, otherRect, other.id)
      const next = pushOut(doc, pageIdx, cur.rect, otherRect, dragAxis, dragSign, region)
      if (!next) {
        if (!blocked.includes(other.id)) blocked.push(other.id)
        continue
      }
      pushed.set(other.id, next)
      if (!queued.has(other.id)) {
        queued.add(other.id)
        queue.push({ id: other.id, rect: next })
      }
    }
  }

  return { rect, pushed, blocked }
}

/* ------------------------------------------------------------------ *
 * 纵向压缩：消除同栏重叠，保持现有间距，不改变上下顺序
 * ------------------------------------------------------------------ */

export function compactPage(doc: Doc, pageIdx: number): boolean {
  const page = doc.pages[pageIdx]
  if (!page) return false
  const g = getGeometry(doc, pageIdx)
  const groups: Record<string, El[]> = { '0': [], '1': [], span: [] }
  for (const el of page.els) {
    if (!isFlowable(el)) continue
    groups[String(columnOf(g, el))].push(el)
  }
  let changed = false
  for (const group of Object.values(groups)) {
    group.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z)
    const placed: El[] = []
    for (const el of group) {
      // 从版心顶部开始紧凑堆叠；锁定元素保持在原位，作为障碍
      let y = g.top
      for (const p of placed) {
        if (hOverlap(el, p)) y = Math.max(y, p.y + p.h + PAGE_GAP)
      }
      if (!el.locked && Math.abs(y - el.y) > 0.01) {
        el.y = y
        changed = true
      }
      placed.push(el)
    }
  }
  return changed
}

/* ------------------------------------------------------------------ *
 * 分页：溢出块整体移到下一页顶部，并顺延下一页内容
 * ------------------------------------------------------------------ */

export function findOverflow(doc: Doc, pageIdx: number): El[] {
  const page = doc.pages[pageIdx]
  if (!page) return []
  const g = getGeometry(doc, pageIdx)
  return page.els
    .filter((el) => isFlowable(el) && el.y + el.h > g.bottom + 0.5)
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

function shiftDown(doc: Doc, pageIdx: number, group: 0 | 1 | 'span', amount: number) {
  const page = doc.pages[pageIdx]
  if (!page || amount <= 0) return
  const g = getGeometry(doc, pageIdx)
  for (const el of page.els) {
    if (!isFlowable(el)) continue
    const col = group === 'span' ? null : columnOf(g, el)
    if (group !== 'span' && col !== group) continue
    if (el.y >= g.top - 1) el.y += amount
  }
}

/**
 * 把一组内容块插到指定页、指定栏的顶部，并顺延该栏原有内容。
 * targetCol=1 时用于“左栏溢出接到同一页右栏”。
 */
export function insertAtTopInColumn(doc: Doc, pageIdx: number, items: El[], targetCol: 0 | 1 | 'span') {
  if (!items.length) return
  const g = getGeometry(doc, pageIdx)
  items.sort((a, b) => a.y - b.y || a.x - b.x)
  const total = items.reduce((s, e) => s + e.h, 0) + PAGE_GAP * Math.max(0, items.length - 1)
  shiftDown(doc, pageIdx, targetCol, total + PAGE_GAP)

  let y = g.top
  for (const el of items) {
    const maxW = targetCol === 'span' ? g.width : g.colW
    el.w = Math.min(el.w, maxW)
    if (targetCol === 'span') el.x = g.left
    else if (el.w >= g.colW - 1) el.x = g.cols[targetCol]
    else el.x = g.cols[targetCol] + Math.max(0, (g.colW - el.w) / 2)
    el.y = y
    y += el.h + PAGE_GAP
    doc.pages[pageIdx].els.push(el)
  }
}

/** 兼容入口：按元素原栏插入 */
export function insertAtTop(doc: Doc, pageIdx: number, items: El[]) {
  const g = getGeometry(doc, pageIdx)
  const groups: Array<{ col: 0 | 1 | 'span'; items: El[] }> = []
  for (const el of items) {
    const col = columnOf(g, el)
    let group = groups.find((x) => x.col === col)
    if (!group) {
      group = { col, items: [] }
      groups.push(group)
    }
    group.items.push(el)
  }
  for (const group of groups) insertAtTopInColumn(doc, pageIdx, group.items, group.col)
}

/** 指定栏中超出页底的元素 */
export function findColumnOverflow(doc: Doc, pageIdx: number, col: 0 | 1): El[] {
  const page = doc.pages[pageIdx]
  if (!page) return []
  const g = getGeometry(doc, pageIdx)
  return page.els
    .filter((el) => isFlowable(el) && !el.noFlow && columnOf(g, el) === col && el.y + el.h > g.bottom + 0.5)
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

/** 跨栏元素超出页底 */
export function findSpanOverflow(doc: Doc, pageIdx: number): El[] {
  const page = doc.pages[pageIdx]
  if (!page) return []
  const g = getGeometry(doc, pageIdx)
  return page.els
    .filter((el) => isFlowable(el) && !el.noFlow && columnOf(g, el) === 'span' && el.y + el.h > g.bottom + 0.5)
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

/** 确保第 idx 页存在；新页自动补页眉/页脚（不补报头） */
export function ensurePage(doc: Doc, idx: number): DocPage {
  while (doc.pages.length <= idx) {
    const src = doc.pages[doc.pages.length - 1] ?? doc.pages[0]
    const page: DocPage = { id: uid('page'), els: [] }
    const furniture = src ? src.els.filter((e) => isFurniture(e) && e.variant !== 'masthead') : []
    let z = src ? Math.max(0, ...src.els.map((e) => e.z)) + 1 : 1
    for (const el of furniture) {
      const c = clone(el)
      c.id = uid('el')
      c.x = MARGIN
      c.w = doc.w - MARGIN * 2
      if (c.variant === 'footer') c.y = doc.h - FOOTER_OFFSET
      c.z = z++
      page.els.push(c)
    }
    // 全屏背景自动复制到新页
    const bg = src?.els.find((e) => e.kind === 'image' && e.background && e.variant === 'bg-image')
    if (bg) {
      const c = clone(bg)
      c.id = uid('el')
      c.x = 0
      c.y = 0
      c.w = doc.w
      c.h = doc.h
      c.z = -100
      page.els.push(c)
    }
    doc.pages.push(page)
  }
  return doc.pages[idx]
}

export function renumberPages(doc: Doc) {
  const total = doc.pages.length
  doc.pages.forEach((page, i) => {
    for (const el of page.els) {
      if (!isFurniture(el) || el.variant !== 'footer' || !el.html) continue
      el.html = el.html.replace(/(—\s*)\d+(\s*\/\s*)\d+(\s*—)/g, `$1${i + 1}$2${total}$3`)
    }
  })
}

/**
 * 全文档回流 + 分页。
 * 会修改传入的 doc（调用方负责传入 clone）。
 */
export function reflowDoc(doc: Doc, opts: { compact?: boolean } = {}): Doc {
  if (!doc.pages.length) doc.pages.push({ id: uid('page'), els: [] })
  const compact = opts.compact !== false
  // 关闭自动翻页时只做同页压缩，不跨页
  if (doc.flow?.autoPage === false) {
    if (compact) doc.pages.forEach((_, i) => compactPage(doc, i))
    renumberPages(doc)
    return doc
  }
  let moveGuard = 0

  for (let pass = 0; pass < 220; pass++) {
    let changed = false
    for (let i = 0; i < doc.pages.length; i++) {
      if (compact && compactPage(doc, i)) changed = true
      let g = getGeometry(doc, i)

      if (i === 0) {
        // 第一页：左右栏都是初始设计内容。溢出统一进入第二页左栏，
        // 先插右栏、再插左栏，保证“左栏内容在右栏内容之前”。
        g = getGeometry(doc, i)
        const right0 = findColumnOverflow(doc, i, 1)
        if (right0.length) {
          const ids = new Set(right0.map((e) => e.id))
          doc.pages[i].els = doc.pages[i].els.filter((e) => !ids.has(e.id))
          for (const el of right0) if (el.h > g.height) el.h = g.height
          ensurePage(doc, i + 1)
          insertAtTopInColumn(doc, i + 1, right0, 0)
          changed = true
          if (++moveGuard > 500) break
        }
        g = getGeometry(doc, i)
        const left0 = findColumnOverflow(doc, i, 0)
        if (left0.length) {
          const ids = new Set(left0.map((e) => e.id))
          doc.pages[i].els = doc.pages[i].els.filter((e) => !ids.has(e.id))
          for (const el of left0) if (el.h > g.height) el.h = g.height
          ensurePage(doc, i + 1)
          insertAtTopInColumn(doc, i + 1, left0, 0)
          changed = true
          if (++moveGuard > 500) break
        }
      } else {
        // 后续页：左栏溢出 → 同一页右栏；右栏溢出 → 下一页左栏。
        g = getGeometry(doc, i)
        const left = findColumnOverflow(doc, i, 0)
        if (left.length) {
          const ids = new Set(left.map((e) => e.id))
          doc.pages[i].els = doc.pages[i].els.filter((e) => !ids.has(e.id))
          for (const el of left) if (el.h > g.height) el.h = g.height
          insertAtTopInColumn(doc, i, left, 1)
          changed = true
          if (++moveGuard > 500) break
        }

        g = getGeometry(doc, i)
        const right = findColumnOverflow(doc, i, 1)
        if (right.length) {
          const ids = new Set(right.map((e) => e.id))
          doc.pages[i].els = doc.pages[i].els.filter((e) => !ids.has(e.id))
          for (const el of right) if (el.h > g.height) el.h = g.height
          ensurePage(doc, i + 1)
          insertAtTopInColumn(doc, i + 1, right, 0)
          changed = true
          if (++moveGuard > 500) break
        }
      }

      // 跨栏元素溢出 → 下一页整幅顶部
      const span = findSpanOverflow(doc, i)
      if (span.length) {
        const ids = new Set(span.map((e) => e.id))
        doc.pages[i].els = doc.pages[i].els.filter((e) => !ids.has(e.id))
        for (const el of span) if (el.h > g.height) el.h = g.height
        ensurePage(doc, i + 1)
        insertAtTopInColumn(doc, i + 1, span, 'span')
        changed = true
        if (++moveGuard > 500) break
      }
    }
    if (!changed) break
    if (doc.pages.length > 120 || moveGuard > 500) break
  }

  renumberPages(doc)
  return doc
}

/* ------------------------------------------------------------------ *
 * 自动高度
 * ------------------------------------------------------------------ */

/**
 * heights: elementId -> 真实内容高度（由 Canvas 在 DOM 里测量）
 */
export function applyHeights(doc: Doc, heights: Record<string, number>): Doc {
  let changed = false
  for (let i = 0; i < doc.pages.length; i++) {
    for (const el of doc.pages[i].els) {
      if (!isMeasurable(el) || el.autoHeight === false) continue
      const h = heights[el.id]
      if (typeof h !== 'number' || !isFinite(h) || h <= 0) continue
      const next = Math.max(8, Math.ceil(h))
      if (Math.abs(next - el.h) > 0.6) {
        el.h = next
        changed = true
      }
    }
    // 报头/页眉变高后，内容不能钻到它下面
    const g = getGeometry(doc, i)
    for (const el of doc.pages[i].els) {
      if (isFlowable(el) && el.y < g.top - 0.5) {
        el.y = g.top
        changed = true
      }
    }
  }
  if (!changed) return doc
  return reflowDoc(doc)
}

/* ------------------------------------------------------------------ *
 * 新增组件：插入并把重叠内容向下推
 * ------------------------------------------------------------------ */

export function placeNewElement(doc: Doc, pageIdx: number, el: El): Doc {
  ensurePage(doc, pageIdx)
  const g = getGeometry(doc, pageIdx)

  // 页眉/页脚/报头：固定在家具区域，不参与内容避让
  if (isFurniture(el)) {
    el.x = MARGIN
    el.w = doc.w - MARGIN * 2
    if (el.variant === 'footer') el.y = doc.h - FOOTER_OFFSET
    if (el.variant === 'header') el.y = HEADER_TOP
    if (el.variant === 'masthead') {
      const head = doc.pages[pageIdx].els.find((e) => isFurniture(e) && e.variant === 'header')
      el.y = (head ? head.y + head.h : MARGIN + HEADER_HEIGHT) + 8
    }
    el.autoHeight = el.variant === 'footer' ? true : el.autoHeight
    if (el.variant === 'footer') {
      doc.pages[pageIdx].els = doc.pages[pageIdx].els.filter((e) => !(isFurniture(e) && e.variant === 'footer'))
    }
    if (el.variant === 'header') {
      doc.pages[pageIdx].els = doc.pages[pageIdx].els.filter((e) => !(isFurniture(e) && e.variant === 'header'))
    }
    if (el.variant === 'masthead') {
      doc.pages[pageIdx].els = doc.pages[pageIdx].els.filter((e) => !(isFurniture(e) && e.variant === 'masthead'))
    }
    doc.pages[pageIdx].els.push(el)
    return reflowDoc(doc)
  }

  // 全屏背景图：铺满页面、置底，不参与栏位/避让/分页
  if (el.background && el.kind === 'image') {
    el.x = 0
    el.y = 0
    el.w = doc.w
    el.h = doc.h
    el.autoHeight = false
    doc.pages[pageIdx].els.push(el)
    return doc
  }

  // 双栏版面：新组件对齐到左/右栏，避免骑在栏缝上导致分组错乱
  if (isFlowable(el)) {
    const col = columnOf(g, el)
    if (col === 'span') {
      el.w = Math.min(el.w, g.width)
      el.x = g.left
    } else {
      el.w = Math.min(el.w, g.colW)
      el.x = el.w >= g.colW - 1 ? g.cols[col] : g.cols[col] + Math.max(0, (g.colW - el.w) / 2)
    }
  }

  const rect = clampContentRect(doc, pageIdx, { x: el.x, y: el.y, w: el.w, h: el.h })
  el.x = rect.x
  el.y = rect.y
  el.w = rect.w
  el.h = rect.h

  if (isFlowable(el)) {
    const page = doc.pages[pageIdx]
    for (const other of page.els) {
      if (other.id === el.id || !isFlowable(other)) continue
      if (hOverlap(rect, other) && other.y + other.h > rect.y && other.y < rect.y + rect.h) {
        other.y = rect.y + rect.h + PAGE_GAP
      }
    }
  }

  doc.pages[pageIdx].els.push(el)
  return reflowDoc(doc)
}

/* ------------------------------------------------------------------ *
 * 横竖版切换 / 重排
 * ------------------------------------------------------------------ */

export function resizeDoc(doc: Doc, newW: number, newH: number): Doc {
  const oldW = doc.w
  const oldGeom = doc.pages.map((_, i) => getGeometry(doc, i))
  const orientation: Orientation = newW > newH ? 'landscape' : 'portrait'

  doc.w = newW
  doc.h = newH
  doc.orientation = orientation
  doc.margin = { top: MARGIN, right: MARGIN, bottom: FOOTER_OFFSET, left: MARGIN }

  const newContentW = newW - MARGIN * 2
  const newColW = Math.max(40, (newContentW - COL_GAP) / 2)
  const newCols: [number, number] = [MARGIN, MARGIN + newColW + COL_GAP]

  doc.pages.forEach((page, pageIdx) => {
    const oldG = oldGeom[pageIdx] ?? oldGeom[0]
    // 全屏背景始终铺满新纸张
    for (const el of page.els) {
      if (el.kind === 'image' && el.background && el.variant === 'bg-image') {
        el.x = 0
        el.y = 0
        el.w = newW
        el.h = newH
      }
    }
    // 先把家具摆到新纸张上
    for (const el of page.els) {
      if (!isFurniture(el)) continue
      el.x = MARGIN
      el.w = newContentW
      if (el.variant === 'footer') el.y = newH - FOOTER_OFFSET
      if (el.variant === 'header') el.y = HEADER_TOP
    }
    // 报头始终跟在页眉下方
    const headBottom = Math.max(
      MARGIN,
      ...page.els.filter((e) => isFurniture(e) && e.variant === 'header').map((e) => e.y + e.h),
    )
    for (const el of page.els) {
      if (isFurniture(el) && el.variant === 'masthead') el.y = headBottom + 8
    }

    for (const el of page.els) {
      if (isFurniture(el)) continue
      if (el.kind === 'image' && el.background && el.variant === 'bg-image') continue
      if (el.kind === 'region') {
        const rx = newContentW / Math.max(1, oldW - MARGIN * 2)
        el.x = MARGIN + (el.x - MARGIN) * rx
        el.w = Math.max(16, el.w * rx)
        el.y = Math.min(el.y, newH - FOOTER_OFFSET - 20)
        el.h = Math.min(el.h, newH - el.y - 20)
        continue
      }
      const col = columnOf(oldG, el)
      if (col === 'span') {
        const ratio = newContentW / Math.max(1, oldG.width)
        el.x = MARGIN + (el.x - MARGIN) * ratio
        el.w = Math.max(16, el.w * ratio)
      } else {
        const ratio = newColW / Math.max(1, oldG.colW)
        el.x = newCols[col] + (el.x - oldG.cols[col]) * ratio
        el.w = Math.max(16, el.w * ratio)
      }
    }
  })

  return reflowDoc(doc)
}

/* ------------------------------------------------------------------ *
 * 单块跨页 / 页管理
 * ------------------------------------------------------------------ */

export function moveElementToPage(doc: Doc, id: string, targetIdx: number): Doc {
  let source: DocPage | null = null
  let el: El | null = null
  for (const page of doc.pages) {
    const found = page.els.find((e) => e.id === id)
    if (found) {
      source = page
      el = found
      break
    }
  }
  if (!source || !el) return doc
  if (targetIdx < 0) return doc
  source.els = source.els.filter((e) => e.id !== id)
  for (const page of doc.pages) {
    if (page.els.some((e) => e.id === id)) page.els = page.els.filter((e) => e.id !== id)
  }
  ensurePage(doc, targetIdx)
  // 手动翻页后置顶，避免被目标页元素盖住
  el.z = Math.max(0, ...doc.pages[targetIdx].els.map((e) => e.z)) + 1
  // 手动翻页统一接到目标页左栏顶部，后续溢出继续按栏顺序流动
  insertAtTopInColumn(doc, targetIdx, [el], 0)
  return reflowDoc(doc)
}

export function addPage(doc: Doc): Doc {
  ensurePage(doc, doc.pages.length)
  renumberPages(doc)
  return doc
}

export function removePage(doc: Doc, idx: number): Doc {
  if (doc.pages.length <= 1 || idx < 0 || idx >= doc.pages.length) return doc
  doc.pages.splice(idx, 1)
  renumberPages(doc)
  return doc
}

/* ------------------------------------------------------------------ *
 * 存档归一化 / 兼容旧版本
 * ------------------------------------------------------------------ */

export function normalizeDoc(input: Doc): Doc {
  const d = clone(input)
  if (!d || typeof d !== 'object' || !Array.isArray(d.pages) || !d.pages.length) {
    throw new Error('文档结构无效')
  }
  d.w = Number(d.w) > 100 ? Number(d.w) : A4.landscape.w
  d.h = Number(d.h) > 100 ? Number(d.h) : A4.landscape.h
  d.orientation = ORIENTATIONS.includes(d.orientation as Orientation)
    ? (d.orientation as Orientation)
    : d.w > d.h
      ? 'landscape'
      : 'portrait'
  d.margin = d.margin ?? { top: MARGIN, right: MARGIN, bottom: FOOTER_OFFSET, left: MARGIN }
  d.flow = { autoHeight: true, autoPage: true, ...(d.flow as FlowConfig | undefined) }
  d.watermark = d.watermark ?? { text: '地理时政周刊', size: 14, opacity: 0.15, angle: -30 }
  d.defaults = d.defaults ?? {
    fontFamily: '"Lantinghei SC","PingFang SC","Heiti SC","SimHei","Microsoft YaHei",sans-serif',
    fontSize: '14px',
  }
  d.version = DOC_VERSION

  d.pages = d.pages.filter((p) => p && Array.isArray(p.els))
  if (!d.pages.length) d.pages.push({ id: uid('page'), els: [] })
  for (const page of d.pages) {
    page.id = page.id || uid('page')
    const seen = new Set<string>()
    page.els = page.els.filter((el) => {
      if (!el || typeof el !== 'object') return false
      if (!['text', 'box', 'image', 'chrome', 'line', 'region'].includes(el.kind)) return false
      if (!isFinite(Number(el.x)) || !isFinite(Number(el.y))) return false
      if (!(Number(el.w) > 0) || !(Number(el.h) > 0)) return false
      el.id = el.id || uid('el')
      if (seen.has(el.id)) el.id = uid('el')
      seen.add(el.id)
      el.x = Number(el.x)
      el.y = Number(el.y)
      el.w = Number(el.w)
      el.h = Number(el.h)
      el.z = Number.isFinite(Number(el.z)) ? Number(el.z) : 1
      return true
    })
  }
  renumberPages(d)
  return d
}

/* ------------------------------------------------------------------ *
 * 损坏版面修复：误拖页眉/报头导致第一页正文被搬走时，
 * 按阅读顺序把所有内容重新装回页面。
 * ------------------------------------------------------------------ */

/** 判断是否明显是“报头被拖到页中/第一页正文被搬空”的损坏版面 */
export function isBrokenLayout(doc: Doc): boolean {
  const page0 = doc.pages[0]
  if (!page0) return false
  const flow0 = page0.els.filter(isFlowable).length
  const laterHasFlow = doc.pages.slice(1).some((p) => p.els.some(isFlowable))
  const mast = page0.els.find((e) => isFurniture(e) && e.variant === 'masthead')
  const mastBad = !!mast && mast.y > HEADER_TOP + HEADER_HEIGHT + 60
  return (flow0 === 0 && laterHasFlow) || mastBad
}

/**
 * 重建分页：
 * 1. 页眉/报头/页脚复位到 A4 页边标准位置；
 * 2. 收集全文档内容，按“页 → 左栏 → 右栏 → 纵坐标”的阅读顺序；
 * 3. 从第 1 页左上重新排，溢出自动翻页；
 * 4. 最后做紧凑压缩。
 *
 * 注意：区域（region）是版面辅助容器，重建时会丢弃；正文/图片/标题都会保留。
 */
export function repairLayout(doc: Doc): Doc {
  if (!doc.pages.length) return reflowDoc(doc)
  const d = doc
  const allEls = d.pages.flatMap((p) => p.els)

  const findFurniture = (variant: string) => allEls.find((e) => isFurniture(e) && e.variant === variant)
  const header = findFurniture('header')
  const masthead = findFurniture('masthead')
  const footer = findFurniture('footer')
  const background = d.pages[0]?.els.find((e) => e.background && e.kind === 'image') ?? allEls.find((e) => e.background && e.kind === 'image')

  // 阅读顺序收集内容
  const flow: El[] = []
  d.pages.forEach((page, pi) => {
    const g = getGeometry(d, pi)
    const items = page.els.filter(isFlowable)
    items.sort((a, b) => {
      const rank = (el: El) => {
        const c = columnOf(g, el)
        return c === 'span' ? 0.5 : c
      }
      return rank(a) - rank(b) || a.y - b.y || a.x - b.x
    })
    flow.push(...items)
  })

  // 只保留第一页，并重建页眉/报头/页脚/背景
  const page0 = d.pages[0]
  page0.els = []
  const addFurniture = (el: El | undefined, variant: 'header' | 'masthead' | 'footer') => {
    if (!el) return
    const c = clone(el)
    c.id = uid('el')
    c.x = MARGIN
    c.w = d.w - MARGIN * 2
    if (variant === 'header') c.y = HEADER_TOP
    if (variant === 'masthead') c.y = HEADER_TOP + HEADER_HEIGHT + 8
    if (variant === 'footer') c.y = d.h - FOOTER_OFFSET
    c.z = variant === 'footer' ? 9992 : variant === 'header' ? 9993 : 9994
    page0.els.push(c)
  }
  addFurniture(header, 'header')
  addFurniture(masthead, 'masthead')
  addFurniture(footer, 'footer')
  if (background) {
    const c = clone(background)
    c.id = uid('el')
    c.x = 0
    c.y = 0
    c.w = d.w
    c.h = d.h
    c.z = -100
    page0.els.push(c)
  }
  d.pages = [page0]

  // 从第一页左上开始顺序装回
  let pi = 0
  let col: 0 | 1 = 0
  let g = getGeometry(d, 0)
  let y = g.top
  for (const el of flow) {
    ensurePage(d, pi)
    g = getGeometry(d, pi)
    if (col === 0 && y + el.h > g.bottom) {
      col = 1
      y = g.top
    }
    if (col === 1 && y + el.h > g.bottom) {
      pi += 1
      ensurePage(d, pi)
      g = getGeometry(d, pi)
      col = 0
      y = g.top
    }
    el.x = g.cols[col]
    el.y = y
    el.w = Math.min(el.w, g.colW)
    el.z = Math.max(0, ...d.pages[pi].els.map((e) => e.z)) + 1
    d.pages[pi].els.push(el)
    y += el.h + PAGE_GAP
  }

  return reflowDoc(d)
}
