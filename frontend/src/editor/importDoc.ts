/**
 * Word 导入结果 → 编辑器文档
 *
 * 关键点：导入器不懂排版。它只做「按阅读顺序把元素分到栏里」，
 * 剩下的高度修正、溢出翻页、按行切割全部交给 layout.ts 的 reflowDoc。
 *
 * 分栏需要真实高度，所以先在离屏容器里按栏宽量一遍。
 *
 * 关于「合并/拆分」
 * 短条目组由 rules.mjs 标了 grp：合并态带 parts（原始分片），拆分态每个分片仍在同一 grp。
 * 因此这里可以在两种形态之间自由切换，并按页数最优自动挑一个。
 */
import type { Doc, DocPage, El, Orientation } from './types'
import { A4, COL_GAP, DOC_VERSION, FOOTER_OFFSET, HEADER_HEIGHT, HEADER_TOP, MARGIN, MASTHEAD_HEIGHT, PAGE_GAP, reflowDoc } from './layout'
import { INITIAL_DOC } from './initialDoc'

export interface RawPart {
  variant: string
  html: string
}

export interface RawElement {
  kind: 'text' | 'box' | 'chrome' | 'image' | 'line'
  variant: string
  html: string
  src?: string
  ratio?: number
  /** 短条目组编号：同组可合并成 1 个组件，也可拆回多个 */
  grp?: number
  /** 合并态下保留的原始分片 */
  parts?: RawPart[]
  /** 阅读顺序（内部使用，装配时写进元素 id） */
  idx?: number
}

export interface ImportPayload {
  ok: boolean
  error?: string
  paragraphs?: number
  elements: RawElement[]
  masthead: string
  header: string
  footer: string
  warnings: string[]
  images?: Array<{ url: string; width: number; height: number }>
  elapsed?: number
  /** 服务端排版时携带的合并策略（默认 auto） */
  mergeMode?: 'auto' | 'merge' | 'split'
}

/** 图片最高高度，与报纸版 .img-ph img 的上限一致（横版基准，竖版按可用高度放宽） */
const IMAGE_MAX_H = 287

/** 合并策略：auto = 按页数与分页情况自动选；merge = 一律合并；split = 一律拆分 */
export type MergeMode = 'auto' | 'merge' | 'split'

export interface ImportOptions {
  merge?: MergeMode
  /** 目标版式：横版（默认）/ 竖版。整页尺寸、栏宽、装栏容量都跟着变 */
  orientation?: Orientation
}

/** 一个版式下的装栏几何 */
interface Geo {
  orientation: Orientation
  pageW: number
  pageH: number
  colW: number
  imageMaxH: number
}

function geoOf(orientation: Orientation): Geo {
  const size = orientation === 'portrait' ? A4.portrait : A4.landscape
  const colW = (size.w - MARGIN * 2 - COL_GAP) / 2
  // 图片高度上限是绝对值，横竖版一致：超高的图交给按栏切割，不硬压成一条
  return { orientation, pageW: size.w, pageH: size.h, colW, imageMaxH: IMAGE_MAX_H }
}

/** 两种装栏尺度。tight 用真实高度（ceil）且不留安全余量，用于「就差一点」的情形 */
const PROFILES = {
  loose: { pad: 2, slack: 10 },
  tight: { pad: 0, slack: 1 },
} as const
type ProfileName = keyof typeof PROFILES

/** 在离屏容器里按栏宽量出每个元素的真实高度 */
async function measureHeights(htmls: string[], width: number): Promise<number[]> {
  const out: number[] = []
  if (!htmls.length) return out

  try {
    await (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready
  } catch {
    /* 字体 API 不可用就直接量 */
  }

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  // 必须带 .ed-page：字体族/字号/行高都在这个类上，换环境量出来的高度会和真实渲染不一致
  host.className = 'ed-page'
  host.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:auto;padding:0;overflow:visible;visibility:hidden;pointer-events:none;z-index:-1;background:transparent`
  document.body.appendChild(host)

  try {
    for (const html of htmls) {
      const wrap = document.createElement('div')
      wrap.className = 'ed-el'
      wrap.style.cssText = 'position:relative;display:block;width:100%;height:auto;box-sizing:border-box'
      const slot = document.createElement('div')
      slot.className = 'ed-slot'
      slot.innerHTML = html
      wrap.appendChild(slot)
      host.appendChild(wrap)
      out.push(Math.ceil(wrap.getBoundingClientRect().height))
      host.removeChild(wrap)
    }
  } finally {
    host.remove()
  }
  return out
}

/* ------------------------------------------------------------------ *
 * 合并 / 拆分
 * ------------------------------------------------------------------ */

/** 把元素展开成指定形态：'all' 全合并、'none' 全拆分、或指定要合并的组号集合 */
type MergePick = 'all' | 'none' | Set<number>

function isMerged(el: RawElement) {
  return !!(el.parts && el.parts.length > 1)
}

function shapeElements(raw: RawElement[], pick: MergePick): RawElement[] {
  const shouldMerge = (grp?: number) => {
    if (grp == null) return false
    if (pick === 'all') return true
    if (pick === 'none') return false
    return pick.has(grp)
  }

  const out: RawElement[] = []
  for (let i = 0; i < raw.length; i++) {
    const el = raw[i]
    if (el.grp == null) {
      out.push(el)
      continue
    }
    if (shouldMerge(el.grp)) {
      // 合并：把同组的连续元素（合并态就是它自己）拼成一个
      const parts: RawPart[] = el.parts ? [...el.parts] : []
      let j = i + 1
      while (j < raw.length && raw[j].grp === el.grp) {
        parts.push({ variant: raw[j].variant, html: raw[j].html })
        j++
      }
      out.push({ ...el, html: parts.map((p) => p.html).join(''), parts })
      i = j - 1
      continue
    }
    // 拆分：合并态展开 parts，拆分态原样保留
    if (isMerged(el)) {
      for (const p of el.parts!) out.push({ ...el, variant: p.variant, html: p.html, parts: undefined })
    } else {
      out.push({ ...el, parts: undefined })
    }
  }
  // 记录阅读顺序，后面判断「合并组是否被分页切断」时要用
  return out.map((el, idx) => ({ ...el, idx }))
}

/* ------------------------------------------------------------------ *
 * 装栏
 * ------------------------------------------------------------------ */

interface Placed {
  el: RawElement
  h: number
}

/**
 * 把元素按顺序装进「页 × 栏」。
 * 每页版心起点不同（第 1 页有报头），所以要逐页计算。
 */
function packPages(items: Placed[], headerH: number, mastheadH: number, profile: { pad: number; slack: number }, geo: Geo) {
  const pageH = geo.pageH
  const topOf = (page: number) => HEADER_TOP + headerH + 8 + (page === 0 && mastheadH ? mastheadH + 8 : 0)
  // 余量太小会在真实测量后被判溢出、又翻回下一页；loose 留 10px，tight 只留 1px
  const bottom = Math.max(topOf(0) + 80, pageH - FOOTER_OFFSET - 8 - profile.slack)

  const pages: Array<Array<{ item: Placed; col: 0 | 1; y: number }>> = [[]]
  let page = 0
  let col: 0 | 1 = 0
  let y = topOf(0)

  for (const item of items) {
    // 单个元素比整栏还高：独占一栏，交给按行切割处理
    if (y > topOf(page) && y + item.h > bottom) {
      if (col === 0) {
        col = 1
        y = topOf(page)
      } else {
        page += 1
        col = 0
        y = topOf(page)
        pages[page] = []
      }
    }
    if (!pages[page]) pages[page] = []
    pages[page].push({ item, col, y })
    y += item.h + PAGE_GAP
  }

  return pages
}

/* ------------------------------------------------------------------ *
 * 装配
 * ------------------------------------------------------------------ */

interface Candidate {
  doc: Doc
  pages: number
  /** 末页填充率：0~1，越小说明末页越空（越像「孤行」） */
  lastFill: number
  /** 被分页切断的合并组 */
  brokenGroups: number[]
  merged: boolean
  profile: ProfileName
}

function assemble(payload: ImportPayload, packed: ReturnType<typeof packPages>, headerH: number, mastheadH: number, geo: Geo) {
  const pageW = geo.pageW
  const pageH = geo.pageH
  const colW = geo.colW
  let z = 20

  const pages: DocPage[] = packed.map((entries, pageIdx) => {
    const els: El[] = []

    if (payload.header) {
      els.push({
        id: `imp-${pageIdx}-header`,
        kind: 'chrome',
        variant: 'header',
        html: payload.header,
        x: MARGIN,
        y: HEADER_TOP,
        w: pageW - MARGIN * 2,
        h: Math.max(HEADER_HEIGHT, headerH || HEADER_HEIGHT),
        z: z++,
        locked: true,
      })
    }

    if (pageIdx === 0 && payload.masthead) {
      els.push({
        id: `imp-${pageIdx}-masthead`,
        kind: 'chrome',
        variant: 'masthead',
        html: payload.masthead,
        x: MARGIN,
        y: HEADER_TOP + (headerH || HEADER_HEIGHT) + 8,
        w: pageW - MARGIN * 2,
        h: Math.max(MASTHEAD_HEIGHT, mastheadH || MASTHEAD_HEIGHT),
        z: z++,
        locked: true,
      })
    }

    if (payload.footer) {
      els.push({
        id: `imp-${pageIdx}-footer`,
        kind: 'chrome',
        variant: 'footer',
        html: payload.footer,
        x: MARGIN,
        y: pageH - FOOTER_OFFSET,
        w: pageW - MARGIN * 2,
        h: 30.3,
        z: 900,
        locked: true,
        autoHeight: true,
      })
    }

    entries.forEach((entry, idx) => {
      const { el, h } = entry.item
      const x = MARGIN + entry.col * (colW + COL_GAP)
      const id = `imp-${el.idx ?? 'x'}-${pageIdx}-${idx}`
      if (el.kind === 'image') {
        els.push({
          id,
          kind: 'image',
          variant: 'image',
          src: el.src ?? '',
          x,
          y: entry.y,
          w: colW,
          h,
          z: z++,
          autoHeight: false,
        })
        return
      }
      els.push({
        id,
        kind: el.kind,
        variant: el.variant,
        html: el.html,
        x,
        y: entry.y,
        w: colW,
        h,
        z: z++,
        autoHeight: true,
      })
    })

    return { id: `imp-page-${pageIdx}`, els }
  })

  if (!pages.length) pages.push({ id: 'imp-page-0', els: [] })

  const doc: Doc = {
    version: DOC_VERSION,
    w: pageW,
    h: pageH,
    orientation: geo.orientation,
    margin: { top: HEADER_TOP, right: MARGIN, bottom: FOOTER_OFFSET, left: MARGIN },
    flow: { autoHeight: true, autoPage: true },
    watermark: { ...INITIAL_DOC.watermark },
    defaults: { ...INITIAL_DOC.defaults },
    pages,
  }
  return doc
}

/** 末页填充率 + 被分页切断的合并组 */
function inspect(doc: Doc, shaped: RawElement[]): { lastFill: number; brokenGroups: number[] } {
  const FURN = new Set(['header', 'masthead', 'footer'])
  const flowable = (e: El) => !(e.kind === 'chrome' && FURN.has(e.variant)) && e.kind !== 'region' && !e.background
  const usable = doc.h - FOOTER_OFFSET - 8 - HEADER_TOP - 60

  const last = doc.pages[doc.pages.length - 1]
  const content = last?.els.filter(flowable) ?? []
  const bottom = content.length ? Math.max(...content.map((e) => e.y + e.h)) : 0
  const top = content.length ? Math.min(...content.map((e) => e.y)) : 0
  const lastFill = content.length ? Math.min(1, (bottom - top) / Math.max(1, usable)) : 0

  // 元素 id 里带了阅读顺序号（imp-<idx>-...），据此反查每个元素落在第几页
  const pageByIdx = new Map<number, number>()
  doc.pages.forEach((p, pi) => {
    for (const e of p.els) {
      const m = /^imp-(\d+)-/.exec(e.id)
      if (m) pageByIdx.set(Number(m[1]), pi)
    }
  })

  const grpMembers = new Map<number, number[]>()
  for (const el of shaped) {
    if (el.grp == null || el.idx == null) continue
    if (!grpMembers.has(el.grp)) grpMembers.set(el.grp, [])
    grpMembers.get(el.grp)!.push(el.idx)
  }

  const brokenGroups: number[] = []
  for (const [grp, members] of grpMembers) {
    if (members.length < 2) continue
    const pages = new Set(members.map((idx) => pageByIdx.get(idx)).filter((v): v is number => v != null))
    if (pages.size > 1) brokenGroups.push(grp)
  }

  return { lastFill, brokenGroups }
}

/** 用一套参数装一次版面 */
async function buildCandidate(
  payload: ImportPayload,
  raw: RawElement[],
  shape: MergePick,
  profileName: ProfileName,
  geo: Geo,
): Promise<Candidate> {
  const profile = PROFILES[profileName]
  const shaped = shapeElements(raw, shape).map((el) => ({ ...el }))
  const textItems = shaped.filter((e) => e.kind !== 'image')
  const heights = await measureHeights(
    textItems.map((e) => e.html),
    geo.colW,
  )

  const items: Placed[] = []
  let hi = 0
  for (const el of shaped) {
    if (el.kind === 'image') {
      const ratio = el.ratio && el.ratio > 0 ? el.ratio : 1.6
      items.push({ el, h: Math.min(geo.imageMaxH, Math.round(geo.colW / ratio)) })
    } else {
      items.push({ el, h: (heights[hi++] ?? 24) + profile.pad })
    }
  }

  const [headerH = HEADER_HEIGHT, mastheadH = MASTHEAD_HEIGHT] = await measureHeights(
    [payload.header, payload.masthead].filter(Boolean),
    geo.pageW - MARGIN * 2,
  )

  const packed = packPages(items, Math.max(HEADER_HEIGHT, headerH || HEADER_HEIGHT), payload.masthead ? mastheadH : 0, profile, geo)
  const doc = reflowDoc(assemble(payload, packed, headerH, mastheadH, geo))

  // reflow 可能新增页，需要重新按真实分页判断
  const { lastFill, brokenGroups } = inspect(doc, shaped)
  const merged = shaped.some((el) => isMerged(el))
  return { doc, pages: doc.pages.length, lastFill, brokenGroups, merged, profile: profileName }
}

/** 在一组候选里取最优：页数最少；同页数取末页更满的（更难看的孤行先淘汰） */
function best(cands: Candidate[]): Candidate | undefined {
  return cands.reduce<Candidate | undefined>((acc, c) => {
    if (!acc) return c
    if (c.pages !== acc.pages) return c.pages < acc.pages ? c : acc
    return c.lastFill > acc.lastFill ? c : acc
  }, undefined)
}

export interface BuildResult {
  doc: Doc
  warnings: string[]
  pageCount: number
  /** 实际采用的短条目形态 */
  merge: 'merge' | 'split'
  /** 实际采用的装栏尺度 */
  profile: ProfileName
  /** 合并组数量（含合并态与拆分态） */
  groups: number
  /** 实际采用的版式 */
  orientation: Orientation
}

/** 主入口：导入 payload → Doc */
export async function importToDoc(payload: ImportPayload, opts: ImportOptions = {}): Promise<BuildResult> {
  const warnings = [...(payload.warnings ?? [])]
  const raw = payload.elements ?? []
  const mode: MergeMode = opts.merge ?? 'auto'
  const geo = geoOf(opts.orientation === 'portrait' ? 'portrait' : 'landscape')
  const groups = new Set(raw.filter((el) => el.grp != null).map((el) => el.grp!)).size

  if (!raw.length) {
    warnings.push('没有识别出任何内容，请检查原稿格式')
    const empty = reflowDoc(assemble(payload, [[]], HEADER_HEIGHT, MASTHEAD_HEIGHT, geo))
    return { doc: empty, warnings, pageCount: empty.pages.length, merge: 'split', profile: 'loose', groups, orientation: geo.orientation }
  }

  const pick = (c: Candidate): BuildResult => ({
    doc: c.doc,
    warnings,
    pageCount: c.pages,
    merge: c.merged ? 'merge' : 'split',
    profile: c.profile,
    groups,
    orientation: geo.orientation,
  })

  if (mode === 'merge' || mode === 'split') {
    const shape: MergePick = mode === 'merge' ? 'all' : 'none'
    const cands: Candidate[] = []
    for (const p of Object.keys(PROFILES) as ProfileName[]) cands.push(await buildCandidate(payload, raw, shape, p, geo))
    const chosen = best(cands)!
    return pick(chosen)
  }

  /* auto：先看全拆分能排几页 */
  const splitCands: Candidate[] = []
  for (const p of Object.keys(PROFILES) as ProfileName[]) splitCands.push(await buildCandidate(payload, raw, 'none', p, geo))
  const splitBest = best(splitCands)!

  /* 全合并的页数 */
  const mergeCands: Candidate[] = []
  for (const p of Object.keys(PROFILES) as ProfileName[]) mergeCands.push(await buildCandidate(payload, raw, 'all', p, geo))
  const mergeBest = best(mergeCands)!

  // 合并能省页就直接合并
  if (mergeBest.pages < splitBest.pages) return pick(mergeBest)

  // 否则保留拆分的细粒度，只把「被分页切断」的组合并后重排一次
  if (splitBest.brokenGroups.length) {
    const repair: Candidate[] = []
    const set = new Set(splitBest.brokenGroups)
    for (const p of Object.keys(PROFILES) as ProfileName[]) repair.push(await buildCandidate(payload, raw, set, p, geo))
    const fixed = best(repair)
    if (fixed && fixed.pages <= splitBest.pages) return pick(fixed)
  }

  return pick(splitBest)
}

/**
 * 暴露给自动化：MCP 的 paiban_import_word 会拿到 /@doc-import 的 JSON，
 * 再在页面里调这里生成版面，这样和点按钮走的是同一条代码路径。
 */
declare global {
  interface Window {
    __paibanImport?: typeof importToDoc
  }
}

if (typeof window !== 'undefined') window.__paibanImport = importToDoc
