import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { El } from './types'
import { ContextMenu, type MenuItem } from './ui/ContextMenu'
import { popNotice } from './confirmNotice'
import { countParts } from './split'
import type { EditorApi } from './store'
import { findRegion, columnOf, getGeometry, isFlowable, isFurniture, isMeasurable, PAGE_GAP, resolveMove, type Rect } from './layout'
import { resolveImageSrc } from './localImage'
import { fileToCompactDataURL } from './imageTools'
import { TableHandles } from './TableHandles'

const HANDLES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const

/**
 * 拖动的「让位」节流：
 * 拖动过程中组件只跟手，不推挤其它内容（老行为是每一帧都推，一拖就整栏飞走）。
 * 指针停稳 DWELL_MS 之后，才把这次推挤应用到版面；一旦继续移动就撤销这次预览。
 * 松手时在落点再落实一次，避免留下重叠。
 */
const DWELL_MS = 800
/** 指针抖动容差（屏幕像素），触控板手抖也不会重置计时 */
const DWELL_TOL = 3

/**
 * 自动测量的收敛上限，超了就放弃自动调整（页面不崩，版面留给用户手动拖）。
 * 正常稿子通常 1~2 轮就收敛，这里留了很宽的余量。
 */
const MAX_SPLIT_TRIES = 3
const MAX_HEIGHT_TRIES = 6
const MAX_MEASURE_ROUNDS = 40

/**
 * 只有「纯文字流」才适合按行切开。
 *
 * 带边框/底色的容器（quiz 测验框、note 提示框、tpl 模板框、trap 易错框、chain 因果链、
 * name-row 姓名行）切开就是两个碎框，视觉上等于把一张卡片撕成两半。
 * 更糟的是切开后新块和原块的高度还会互相比对，跟测量打架。
 * 这类一律整块挪到下一栏/下一页，不切。
 */
const SPLITTABLE_VARIANTS = new Set(['paragraph', 'subhead', 'req'])

export interface SplitPayload {
  topHtml: string
  topH: number
  bottomHtml: string
  bottomH: number
}

/**
 * 在页底按“整行”找到切割点，返回上半段/下半段 HTML 与高度。
 * 用 Range 逐字二分，保证不会把一行字切成两半。
 */
function splitSlotAt(slot: HTMLElement, cutoffClientY: number, zoom: number, natural: number): SplitPayload | null {
  const walker = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT)
  const nodes: Array<{ node: Text; start: number; len: number }> = []
  let total = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const len = node.data.length
    if (!len) continue
    nodes.push({ node, start: total, len })
    total += len
  }
  if (!total) return null

  const locate = (offset: number) => {
    for (const item of nodes) {
      if (offset < item.start + item.len) {
        return { node: item.node, offset: Math.max(0, Math.min(item.len, offset - item.start)) }
      }
    }
    return null
  }
  const rectFor = (offset: number) => {
    const loc = locate(offset)
    if (!loc) return null
    const range = document.createRange()
    range.setStart(loc.node, loc.offset)
    range.setEnd(loc.node, Math.min(loc.node.data.length, loc.offset + 1))
    const rects = range.getClientRects()
    const rect = rects[0] ?? range.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) return null
    return rect
  }

  // 找到第一个“底边已经越过页底”的字符
  let lo = 0
  let hi = total
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const rect = rectFor(mid)
    if (!rect) {
      lo = mid + 1
      continue
    }
    if (rect.bottom > cutoffClientY) hi = mid
    else lo = mid + 1
  }
  const firstBad = lo
  if (firstBad >= total) return null
  const badRect = rectFor(firstBad)
  if (!badRect) return null

  // 再找到这一行的行首，保证整行一起搬到下一页
  const lineTop = badRect.top
  lo = 0
  hi = firstBad
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const rect = rectFor(mid)
    if (rect && rect.top >= lineTop - 0.5) hi = mid
    else lo = mid + 1
  }
  const splitOffset = lo
  if (splitOffset <= 0) return null

  const loc = locate(splitOffset)
  if (!loc) return null
  const topRange = document.createRange()
  topRange.setStart(slot, 0)
  topRange.setEnd(loc.node, loc.offset)
  const bottomRange = document.createRange()
  bottomRange.setStart(loc.node, loc.offset)
  bottomRange.setEnd(slot, slot.childNodes.length)

  const slotRect = slot.getBoundingClientRect()
  const topRect = topRange.getBoundingClientRect()
  const topH = (topRect.bottom - slotRect.top) / zoom
  const bottomH = natural - topH
  if (!isFinite(topH) || !isFinite(bottomH) || topH < 16 || bottomH < 8) return null

  const topDiv = document.createElement('div')
  topDiv.appendChild(topRange.cloneContents())
  const bottomDiv = document.createElement('div')
  bottomDiv.appendChild(bottomRange.cloneContents())
  const topHtml = topDiv.innerHTML.trim()
  const bottomHtml = bottomDiv.innerHTML.trim()
  if (!topHtml || !bottomHtml) return null
  const topText = (topDiv.textContent || '').replace(/\s+/g, '')
  const bottomText = (bottomDiv.textContent || '').replace(/\s+/g, '')
  // 避免切出只有标点/一两个字的碎片：上下两段都至少要有 12 个字符
  if (topText.length < 12 || bottomText.length < 12) return null
  if (bottomH < 24) return null

  return { topHtml, topH, bottomHtml, bottomH }
}
type Handle = (typeof HANDLES)[number]

export function ElContent({ el }: { el: El }) {
  if (el.kind === 'image') {
    return el.src ? (
      <img className="ed-img" src={resolveImageSrc(el.src)} alt="" draggable={false} />
    ) : (
      <div className="ed-img-ph">图片位</div>
    )
  }
  if (el.kind === 'region') {
    return <div className="ed-region-label">{el.label || '区域'}</div>
  }
  if (el.variant === 'qr') {
    const qr = el.src ? resolveImageSrc(el.src) : ''
    const html = (el.html ?? '').replace(
      /<div class="code"[^>]*><\/div>/,
      `<div class="code">${qr ? `<img src="${qr.replace(/"/g, '&quot;')}" alt="二维码" draggable="false" />` : ''}</div>`,
    )
    return <div className="ed-slot" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return <div className="ed-slot" dangerouslySetInnerHTML={{ __html: el.html ?? '' }} />
}

interface ElViewProps {
  el: El
  api: EditorApi
  pageIdx: number
  onHoverPage?: (page: number | null) => void
  onGhost?: (ghost: { id: string; x: number; y: number } | null) => void
}

function ElView({ el, api, pageIdx, onHoverPage, onGhost }: ElViewProps) {
  const selected = api.selection === el.id
  /** 多选里的「配角」：高亮但没有控制柄 */
  const multi = !selected && api.selectedIds.includes(el.id)
  const editing = api.editingId === el.id
  const ref = useRef<HTMLDivElement>(null)
  // 拖动状态必须走 state：className 由 React 计算，命令式 classList 会被重渲染冲掉
  const [dragging, setDragging] = useState(false)
  const [pushHint, setPushHint] = useState(false)
  const [ghosted, setGhosted] = useState(false)

  // 复合组件内部元素：直接子元素可单独覆盖样式和位置
  useLayoutEffect(() => {
    const slot = ref.current?.querySelector('.ed-slot') as HTMLElement | null
    const root = slot?.firstElementChild as HTMLElement | null
    if (!root) return
    const parts = Array.from(root.children) as HTMLElement[]
    parts.forEach((part, i) => {
      const st = el.sub?.[String(i)] ?? {}
      part.dataset.subIndex = String(i)
      part.style.fontFamily = st.fontFamily ?? ''
      part.style.fontSize = st.fontSize ?? ''
      part.style.fontWeight = st.fontWeight ?? ''
      part.style.fontStyle = st.italic ? 'italic' : ''
      part.style.textDecoration = st.underline ? 'underline' : ''
      part.style.color = st.color ?? ''
      part.style.textAlign = st.align ?? ''
      part.style.lineHeight = st.lineHeight ?? ''
      part.style.letterSpacing = st.letterSpacing ?? ''
      const moved = (st.dx ?? 0) !== 0 || (st.dy ?? 0) !== 0
      part.style.position = moved ? 'relative' : ''
      part.style.left = st.dx ? `${st.dx}px` : ''
      part.style.top = st.dy ? `${st.dy}px` : ''
      part.classList.toggle('is-sub-selected', api.subSelection?.elId === el.id && api.subSelection.index === i)
    })
  }, [el.sub, el.html, api.subSelection, el.id])

  const startDrag = useCallback(
    (e: React.PointerEvent, mode: 'move' | Handle) => {
      if (editing) return
      /* 锁定元素（页眉 / 页脚 / 报头）不能拖动，但必须能选中：
       * 属性面板里要能改样式、双击要能改文字。以前这里直接 return，
       * 结果点上去毫无反应，像坏了。 */
      if (el.locked) {
        e.stopPropagation()
        e.preventDefault()
        api.setPrimary(el.id)
        api.setSubSelection(null)
        return
      }
      e.stopPropagation()
      e.preventDefault()

      const doc0 = api.getDoc()
      const live = doc0.pages[pageIdx]?.els.find((x) => x.id === el.id) ?? el
      const furniture = isFurniture(live)
      // 拖动多选组里的某一块时保留整组选中，只把它提为主选中
      if (api.selectedIds.length > 1 && api.selectedIds.includes(el.id)) api.setPrimary(el.id)
      else api.setSelection(el.id)
      api.setSubSelection(null)
      api.beginTx()

      // 置顶延后到真正拖动时（见 raiseToTop）：单击只是选中，不该改 z，
      // 否则单击也会在撤销栈里压一条「置顶」，第一次 Ctrl+Z 看着毫无反应。
      const node = ref.current
      setDragging(true)

      const targetEl = e.currentTarget as HTMLElement
      const startX = e.clientX
      const startY = e.clientY
      const orig = { x: live.x, y: live.y, w: live.w, h: live.h }
      /** 首次真正拖动时把组件提到最上层；只做一次，避免每帧改 z */
      let raised = false
      const raiseToTop = () => {
        if (raised || live.kind === 'region') return
        raised = true
        const maxZ = Math.max(0, ...(api.getDoc().pages[pageIdx]?.els ?? []).map((x) => x.z))
        if (live.z < maxZ) api.updateEl(el.id, { z: maxZ + 1 }, false)
      }
      // 拖动起点所在区域决定约束：元素在区域内时不会被拖出区域
      const regionEl = live.kind === 'region' ? null : findRegion(doc0, pageIdx, orig, el.id)
      const region = regionEl ? { x: regionEl.x, y: regionEl.y, w: regionEl.w, h: regionEl.h } : null
      let last = orig
      let lastClientY = e.clientY
      let lastTarget = pageIdx

      /* —— 推挤节流：拖动中只跟手，停稳 DWELL_MS 才推挤其它组件 —— */
      let pending = new Map<string, Rect>()
      let pushing = false
      const pristine = new Map<string, Rect>()
      let dwellTimer: number | null = null
      let dwellAnchor = { x: startX, y: startY }

      /**
       * 计算「让位」结果：同栏内按阅读顺序向下顺推，每个元素只排在它上面那个的下面。
       * 不用 resolveMove 的 pushed —— 那套沿方向试探的级联会反复互相推，
       * 停下来那一刻会把若干元素一起堆到页底（看起来像“顶飞”）。
       */
      const planPush = (rect: Rect) => {
        const cur = api.getDoc()
        const geom = getGeometry(cur, pageIdx)
        const col = columnOf(geom, rect)
        const others = (cur.pages[pageIdx]?.els ?? [])
          .filter((x) => isFlowable(x) && !x.background && x.kind !== 'region' && x.id !== el.id)
          .filter((x) => {
            const c = columnOf(geom, x)
            return c === col || c === 'span' || col === 'span'
          })
          .sort((a, b) => a.y - b.y || a.x - b.x)

        const plan = new Map<string, Rect>()
        let cursor = rect.y + rect.h + PAGE_GAP
        for (const x of others) {
          // 完全在拖动元素上方的：不受影响
          if (x.y + x.h <= rect.y + 0.5) continue
          const y = Math.max(x.y, cursor)
          if (x.locked) {
            // 锁定元素不动，但也不能把别的内容推到它身上
            cursor = Math.max(cursor, x.y + x.h + PAGE_GAP)
            continue
          }
          if (y > x.y + 0.5) plan.set(x.id, { x: x.x, y, w: x.w, h: x.h })
          cursor = Math.max(cursor, y + x.h + PAGE_GAP)
        }
        return plan
      }

      const clearDwell = () => {
        if (dwellTimer != null) {
          window.clearTimeout(dwellTimer)
          dwellTimer = null
        }
      }

      /** 撤销已应用的推挤，把被挤的组件放回原位 */
      const undoPush = () => {
        setPushHint(false)
        if (!pushing) return
        pristine.forEach((rect, id) => api.updateEl(id, rect, false))
        pristine.clear()
        pushing = false
      }

      /** 停够了：把待定的推挤真正应用（先记下原位，方便再动时回退） */
      const applyPush = () => {
        setPushHint(false)
        if (!pending.size) return
        const cur = api.getDoc()
        pending.forEach((rect, id) => {
          if (!pristine.has(id)) {
            const src = cur.pages[pageIdx]?.els.find((x) => x.id === id)
            if (src) pristine.set(id, { x: src.x, y: src.y, w: src.w, h: src.h })
          }
          api.updateEl(id, rect, false)
        })
        pushing = true
      }

      /** 指针动了（超过容差）→ 撤销预览并重新计时 */
      const onPointerMoved = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - dwellAnchor.x, ev.clientY - dwellAnchor.y) <= DWELL_TOL) return false
        dwellAnchor = { x: ev.clientX, y: ev.clientY }
        clearDwell()
        undoPush()
        return true
      }

      /** 指针停住：若有待推挤，安排 DWELL_MS 后应用 */
      const armPush = () => {
        if (!pending.size || pushing) {
          setPushHint(false)
          return
        }
        setPushHint(true)
        if (dwellTimer == null) dwellTimer = window.setTimeout(applyPush, DWELL_MS)
      }

      /** 指针下的目标页；越过最后一页时返回 pages.length（新建一页） */
      const targetPageAt = (clientX: number, clientY: number) => {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('.ed-page'))
        const rects = nodes.map((n) => n.getBoundingClientRect())
        for (let i = 0; i < rects.length; i++) {
          const r = rects[i]
          if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return i
        }
        const src = rects[pageIdx]
        if (src && clientY > src.bottom) return Math.min(pageIdx + 1, rects.length)
        if (src && clientY < src.top) return Math.max(0, pageIdx - 1)
        return pageIdx
      }

      const move = (ev: PointerEvent) => {
        onPointerMoved(ev)
        // 真的拖起来了才置顶：拖动中的组件必须压在其他块上面，否则会被不透明块吃掉
        if (!raised && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) raiseToTop()
        const doc = api.getDoc()
        const dx = (ev.clientX - startX) / api.zoom
        const dy = (ev.clientY - startY) / api.zoom
        let next = { x: orig.x, y: orig.y, w: orig.w, h: orig.h }
        if (mode === 'move') {
          next.x = orig.x + dx
          next.y = orig.y + dy
        } else {
          if (mode.includes('e')) next.w = Math.max(16, orig.w + dx)
          if (mode.includes('s')) next.h = Math.max(12, orig.h + dy)
          if (mode.includes('w')) {
            next.w = Math.max(16, orig.w - dx)
            next.x = orig.x + (orig.w - next.w)
          }
          if (mode.includes('n')) {
            next.h = Math.max(12, orig.h - dy)
            next.y = orig.y + (orig.h - next.h)
          }
        }
        next.x = api.snapVal(next.x)
        next.y = api.snapVal(next.y)
        if (mode !== 'move') {
          next.w = api.snapVal(next.w)
          next.h = api.snapVal(next.h)
        }

        lastClientY = ev.clientY

        // 靠近画布上下边缘时自动滚动，方便把组件拖到其他页
        const scroller = document.querySelector<HTMLElement>('.ed-canvas-scroll')
        if (scroller) {
          const sr = scroller.getBoundingClientRect()
          if (ev.clientY < sr.top + 44) scroller.scrollTop -= 14
          else if (ev.clientY > sr.bottom - 44) scroller.scrollTop += 14
        }
        if (mode === 'move' && !furniture) {
          lastTarget = targetPageAt(ev.clientX, ev.clientY)
          const crossPage = lastTarget !== pageIdx
          setGhosted(crossPage)
          onHoverPage?.(crossPage ? lastTarget : null)
          if (crossPage) {
            // 指针已经在其他页/新页上：源页不再继续推挤，改为跟随指针的浮层预览
            onGhost?.({ id: el.id, x: ev.clientX, y: ev.clientY })
            return
          }
          onGhost?.(null)
        } else {
          lastTarget = pageIdx
          setGhosted(false)
          onGhost?.(null)
          onHoverPage?.(null)
        }

        if (live.kind === 'region') {
          next.x = Math.min(Math.max(next.x, 0), doc.w - next.w)
          next.y = Math.min(Math.max(next.y, 0), doc.h - next.h)
          last = next
          api.updateEl(el.id, next, false)
          return
        }

        // 自动避让 + 边界/区域约束（真实位置由 resolveMove 返回）
        const res = resolveMove(doc, pageIdx, el.id, next, last, region)
        last = res.rect
        api.updateEl(el.id, res.rect, false)
        // 推挤先挂起：等指针停稳 DWELL_MS 才应用，避免拖动中把整栏内容顶飞
        pending = planPush(res.rect)
        armPush()
      }

      const up = (ev: PointerEvent) => {
        try {
          targetEl.releasePointerCapture?.(e.pointerId)
        } catch {
          /* 合成事件无捕获 */
        }
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setDragging(false)
        setPushHint(false)
        clearDwell()

        onHoverPage?.(null)
        onGhost?.(null)
        setGhosted(false)
        const doc = api.getDoc()
        const geom = getGeometry(doc, pageIdx)
        const pageNode = node?.closest('.ed-page') as HTMLElement | null
        const pageRect = pageNode?.getBoundingClientRect()
        const belowPage = !!pageRect && lastClientY > pageRect.bottom - 2
        const belowContent = last.y + last.h > geom.bottom + 2
        const target = targetPageAt(ev.clientX, ev.clientY)

        // 拖到其他页：撤销本页的临时下推，再按落点放到目标页
        if (mode === 'move' && !furniture && !live.locked && target !== pageIdx) {
          const targetNode = document.querySelectorAll<HTMLElement>('.ed-page')[target]
          const targetRect = targetNode?.getBoundingClientRect()
          const localX = targetRect ? (ev.clientX - targetRect.left) / api.zoom : Math.round((doc.w - live.w) / 2)
          const localY = targetRect ? (ev.clientY - targetRect.top) / api.zoom : 80
          api.cancelTx()
          api.moveElToPageAt(el.id, target, localX, localY)
          return
        }

        if (mode === 'move' && !furniture && live.kind !== 'region' && !live.locked && (belowPage || belowContent)) {
          // 拖出页底：撤销本次拖动造成的整栏下推，只把这一个组件搬到下一页顶部
          api.cancelTx()
          api.moveElToNextPage(el.id)
          api.setPageIdx(pageIdx + 1)
          return
        }

        if (mode !== 'move' && (mode.includes('n') || mode.includes('s'))) {
          // 手动改高度后关闭自动高度，避免被测量结果立刻弹回去
          api.updateEl(el.id, { autoHeight: false }, false)
        }
        // 落点确认：把最后一次待定的推挤落实，否则会留下重叠
        if (!pushing) applyPush()
        api.updateEl(el.id, last, false)
        api.endTx() // 拖动/缩放/避让/分页整体记一次历史
      }

      try {
        targetEl.setPointerCapture?.(e.pointerId)
      } catch {
        /* 合成事件无捕获 */
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [api, editing, el, pageIdx, onHoverPage, onGhost],
  )

  const s = el.style ?? {}
  const style: React.CSSProperties & Record<string, string | number> = {
    left: el.x,
    top: el.y,
    width: el.w,
    height: el.h,
    zIndex: el.z,
    ...(s.fontFamily ? { fontFamily: s.fontFamily } : {}),
    ...(s.fontSize ? { fontSize: s.fontSize, '--el-font-size': s.fontSize } : {}),
    ...(s.fontWeight ? { fontWeight: s.fontWeight } : {}),
    ...(s.italic ? { fontStyle: 'italic' as const } : {}),
    ...(s.underline || s.strike
      ? { textDecoration: [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ') }
      : {}),
    ...(s.color ? { color: s.color } : {}),
    ...(s.background ? { background: s.background, '--el-bg': s.background } : {}),
    ...(s.lineHeight ? { lineHeight: s.lineHeight, '--el-line-height': s.lineHeight } : {}),
    ...(s.letterSpacing ? { letterSpacing: s.letterSpacing } : {}),
    ...(s.align ? { textAlign: s.align } : {}),
    ...(s.padding ? { padding: s.padding } : {}),
    ...(s.lineWidth ? { '--el-line-width': s.lineWidth } : {}),
    ...(el.variant === 'qr' && el.src ? { '--qr-img': `url("${resolveImageSrc(el.src)}")` } : {}),
    ...(s.opacity !== undefined ? { opacity: s.opacity } : {}),
    ...(s.rotate ? { transform: `rotate(${s.rotate}deg)` } : {}),
  }

  return (
    <div
      ref={ref}
      data-el-id={el.id}
      className={`ed-el ed-kind-${el.kind} ed-v-${el.variant}${s.background ? ' has-custom-bg' : ''}${selected ? ' is-selected' : ''}${multi ? ' is-multi-selected' : ''}${el.locked ? ' is-locked' : ''}${editing ? ' is-editing' : ''}${dragging ? ' is-dragging' : ''}${pushHint ? ' is-awaiting-push' : ''}${ghosted ? ' is-ghosted' : ''}`}
      style={style}
      onPointerDown={(e) => {
        if (editing || api.drawMode) return
        // 点选组件时把焦点从输入框/下拉框移开，方向键才能微调组件
        const ae = document.activeElement as HTMLElement | null
        if (ae && ae !== document.body && !e.currentTarget.contains(ae)) ae.blur()
        /* 多选：Shift = 按阅读顺序连选；Cmd / Ctrl = 单个加选、再点取消 */
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          e.stopPropagation()
          e.preventDefault()
          if (e.shiftKey) api.selectRangeTo(el.id)
          else api.toggleSelect(el.id)
          return
        }
        // 已选中复合组件时，再点内部元素 = 选中内部元素；点背景才拖动整个组件
        if (selected) {
          const part = (e.target as HTMLElement).closest('[data-sub-index]') as HTMLElement | null
          if (part && ref.current?.contains(part)) {
            e.stopPropagation()
            e.preventDefault()
            api.setSubSelection({ elId: el.id, index: Number(part.dataset.subIndex) })
            return
          }
        }
        startDrag(e, 'move')
      }}
      onDoubleClick={(e) => {
        // 页眉/页脚/报头是锁定元素：不允许拖动，但双击进编辑是安全的（只改内容不改位置）
        if (el.kind === 'image' || el.kind === 'region') return
        e.stopPropagation()
        api.setSelection(el.id)
        api.setEditingId(el.id)
        requestAnimationFrame(() => {
          const slot = ref.current?.querySelector('.ed-slot') as HTMLElement | null
          slot?.focus()
          if (slot) {
            const range = document.createRange()
            range.selectNodeContents(slot)
            range.collapse(false)
            const sel = window.getSelection()
            sel?.removeAllRanges()
            sel?.addRange(range)
          }
        })
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {editing ? (
        <div
          className="ed-slot ed-live"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          dangerouslySetInnerHTML={{ __html: el.html ?? '' }}
          onBlur={(e) => {
            api.updateEl(el.id, { html: e.currentTarget.innerHTML }, true)
            const to = e.relatedTarget as HTMLElement | null
            // 焦点转到工具栏/格式栏时保持编辑态，便于连续排版
            if (to && (to.closest('.ed-formatbar') || to.closest('.ed-toolbar'))) return
            api.setEditingId(null)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
              e.preventDefault()
              ;(e.currentTarget as HTMLElement).blur()
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onInput={(e) => {
            /* 输入过程中就让框跟着长高，不必等退出编辑。
             * 只改 DOM 高度、不写文档：写文档会重建 contentEditable、把光标弄丢。 */
            const node = ref.current
            if (!node) return
            const natural = Math.ceil(e.currentTarget.scrollHeight)
            if (natural > 8) node.style.height = `${natural}px`
          }}
        />
      ) : (
        <ElContent el={el} />
      )}
      {selected && !editing && !el.locked && HANDLES.map((h) => (
        <i key={h} className={`ed-handle ed-h-${h}`} onPointerDown={(e) => startDrag(e, h)} />
      ))}
      {selected && !editing && el.variant === 'table' && <TableHandles el={el} api={api} hostRef={ref} />}
    </div>
  )
}

function PageView({ api, pageIdx, dropTarget, isLast, onHoverPage, onGhost }: { api: EditorApi; pageIdx: number; dropTarget?: boolean; isLast?: boolean; onHoverPage?: (page: number | null) => void; onGhost?: (ghost: { id: string; x: number; y: number } | null) => void }) {
  const { doc, grid, zoom } = api
  const page = doc.pages[pageIdx]
  const pageRef = useRef<HTMLDivElement>(null)
  const [band, setBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  /** 蓝色框的两种用途：画区域（drawMode）还是框选组件 */
  const [bandMode, setBandMode] = useState<'region' | 'marquee'>('region')

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    api.setPageIdx(pageIdx)

    // 拖入的是图片文件：直接落到松手位置（自动压缩后内嵌）
    const imageFiles = Array.from(e.dataTransfer.files ?? []).filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length) {
      const rect = pageRef.current!.getBoundingClientRect()
      const geom = getGeometry(doc, pageIdx)
      let dropX = api.snapVal((e.clientX - rect.left) / zoom)
      let dropY = api.snapVal((e.clientY - rect.top) / zoom)
      imageFiles.forEach((f, i) => {
        const w = 300
        const h = 200
        // 超出页底的图片流到下一页顶部
        let targetPage = pageIdx
        if (dropY + h > geom.bottom + 2) {
          targetPage = pageIdx + 1
          dropX = geom.left
          dropY = 0
        }
        const x = dropX + i * 24
        const y = dropY + i * 24
        fileToCompactDataURL(f).then((src) => {
          const img = new Image()
          img.onload = () => {
            // 按真实比例修一次高度（宽度固定 300）
            const ratio = img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 2 / 3
            api.updateEl(id, { h: Math.round(300 * Math.min(3, Math.max(0.2, ratio))) })
          }
          img.src = src
          const id = api.addEl(targetPage, { kind: 'image', variant: 'illustration', src, x, y, w, h })
        })
      })
      return
    }

    const payload = e.dataTransfer.getData('application/x-paiban-component')
    if (!payload) return
    const parsed = JSON.parse(payload) as Partial<El>
    const rect = pageRef.current!.getBoundingClientRect()
    const geom = getGeometry(doc, pageIdx)
    let x = api.snapVal((e.clientX - rect.left) / zoom)
    let y = api.snapVal((e.clientY - rect.top) / zoom)
    const kind = (parsed.kind as El['kind']) ?? 'text'
    const w = parsed.w ?? 240
    const h = parsed.h ?? 32

    // 拖到页底之外：直接投放到下一页顶部
    let targetPage = pageIdx
    if (kind !== 'region' && y + h > geom.bottom + 2) {
      targetPage = pageIdx + 1
      x = geom.left
      y = 0
    }

    const id = api.addEl(targetPage, {
      kind,
      variant: parsed.variant ?? 'paragraph',
      html: parsed.html,
      src: parsed.src,
      label: parsed.label,
      x,
      y,
      w,
      h,
      style: parsed.style,
    })
    api.setSelection(id)
    api.setPageIdx(targetPage)
  }

  const startBand = (e: React.PointerEvent) => {
    api.setPageIdx(pageIdx)
    const ae = document.activeElement as HTMLElement | null
    if (ae && ae !== document.body) ae.blur()
    if (!api.drawMode) {
      /* 空白处拖动 = 框选多个组件（单纯点一下 = 取消选择）。
       * 按住 Shift / Cmd 拖则是「加选」：框到的并进已有选择。 */
      api.setEditingId(null)
      const additive = e.shiftKey || e.metaKey || e.ctrlKey
      if (!additive) api.clearSelection()
      const keep = additive ? api.selectedIds.slice() : []
      const rect = pageRef.current!.getBoundingClientRect()
      const sx = (e.clientX - rect.left) / zoom
      const sy = (e.clientY - rect.top) / zoom
      let last: { x: number; y: number; w: number; h: number } | null = null
      const move = (ev: PointerEvent) => {
        const cx = (ev.clientX - rect.left) / zoom
        const cy = (ev.clientY - rect.top) / zoom
        const box = {
          x: Math.min(sx, cx),
          y: Math.min(sy, cy),
          w: Math.abs(cx - sx),
          h: Math.abs(cy - sy),
        }
        if (box.w < 3 && box.h < 3) return
        last = box
        if (box.w >= 4 && box.h >= 4) {
          setBandMode('marquee')
          setBand(box)
        }
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setBand(null)
        const box = last
        if (!box) return
        const els = api.getDoc().pages[pageIdx]?.els ?? []
        const hit = els
          .filter((x) => !x.background && x.kind !== 'region')
          .filter((x) => !(x.x + x.w < box.x || x.x > box.x + box.w || x.y + x.h < box.y || x.y > box.y + box.h))
          .map((x) => x.id)
        const ids = Array.from(new Set([...keep, ...hit]))
        if (ids.length) api.setSelectionGroup(ids)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return
    }
    e.preventDefault()
    const rect = pageRef.current!.getBoundingClientRect()
    const sx = (e.clientX - rect.left) / zoom
    const sy = (e.clientY - rect.top) / zoom
    setBandMode('region')
    setBand({ x: sx, y: sy, w: 0, h: 0 })
    const move = (ev: PointerEvent) => {
      const cx = (ev.clientX - rect.left) / zoom
      const cy = (ev.clientY - rect.top) / zoom
      setBand({ x: Math.min(sx, cx), y: Math.min(sy, cy), w: Math.abs(cx - sx), h: Math.abs(cy - sy) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setBand((b) => {
        if (b && b.w > 8 && b.h > 8) {
          const n = page?.els.filter((e) => e.kind === 'region').length ?? 0
          api.addEl(pageIdx, {
            kind: 'region',
            variant: 'region',
            label: `区域 ${n + 1}`,
            x: api.snapVal(b.x),
            y: api.snapVal(b.y),
            w: api.snapVal(b.w),
            h: api.snapVal(b.h),
          })
        }
        return null
      })
      api.setDrawMode(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={`ed-page-wrap${api.pageIdx === pageIdx ? ' is-active' : ''}${dropTarget ? ' is-drop-target' : ''}${isLast ? ' is-last' : ''}`}
      style={{ width: doc.w * zoom, height: doc.h * zoom }}
    >
      {dropTarget && <div className="ed-drop-badge">松手移到第 {pageIdx + 1} 页</div>}
      <div
        ref={pageRef}
        className="ed-page"
        data-page-idx={pageIdx}
        style={{ width: doc.w, height: doc.h, transform: `scale(${zoom})` }}
        onPointerDown={startBand}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        {grid.show && <div className="ed-grid" style={{ backgroundSize: `${grid.cell}px ${grid.cell}px` }} />}
        <div className="ed-watermark" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              style={{
                fontSize: doc.watermark.size,
                opacity: doc.watermark.opacity,
                transform: `rotate(${doc.watermark.angle}deg)`,
              }}
            >
              {doc.watermark.text}
            </span>
          ))}
        </div>
        {page?.els.map((el) => (
          <ElView key={el.id} el={el} api={api} pageIdx={pageIdx} onHoverPage={onHoverPage} onGhost={onGhost} />
        ))}
        {band && (
          <div
            className={`ed-band${bandMode === 'marquee' ? ' is-marquee' : ''}`}
            style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
          />
        )}
        <div className="ed-page-tag">
          第 {pageIdx + 1} 页 / 共 {doc.pages.length} 页
        </div>
        <div className="ed-page-drop-hint">↓ 拖到页底以外松手，自动移到下一页</div>
      </div>
    </div>
  )
}

export function Canvas({ api }: { api: EditorApi }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [dragPage, setDragPage] = useState<number | null>(null)
  const [dragGhost, setDragGhost] = useState<{ id: string; x: number; y: number } | null>(null)
  /** 右键菜单：鼠标位置 + 目标组件 + 右键那一刻的选中集合 */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string; ids: string[] } | null>(null)
  const zoomRef = useRef(api.zoom)
  zoomRef.current = api.zoom
  // 捏合锚点：记住手势起点的滚动/缩放基准，缩放生效后一次校正（批量事件也精确）
  const pinchRef = useRef<{ sx: number; sy: number; zoom: number; ax: number; ay: number } | null>(null)

  /**
   * 自动测量的「闸」。
   *
   * 测量是个闭环：量 DOM 高度 → 写回 doc → 重渲染 → 再量。排不下就跨页切一刀，切出续块再量。
   * 正常情况下几轮就收敛。但只要出现「量出来的高度来回摆」或「切完还是装不下」，
   * 这个环就永远转不停，React 连撞 50 次后直接抛 #185（Maximum update depth），整个编辑器崩掉。
   * 线上就踩过一次：一份 5 页的稿子打开即白屏。
   *
   * 所以给环上两道闸：同一元素改太多次 / 切太多次，就放弃自动调整，让它原地溢出。
   * 版面可能不完美，但页面不会崩，用户可以手动拖一下收场。
   */
  const splitTries = useRef(new Map<string, number>())
  const heightTries = useRef(new Map<string, number>())
  /** 内容比一栏还高的块，提示过一次就不再重复 */
  const overflowWarned = useRef(new Set<string>())
  /** 连续多少轮测量还在改东西。一直不收敛就整体收手，防止不同元素轮流改把环续上 */
  const measureRounds = useRef(0)
  /** 收手后的冷却截止时间：过了这个点用户再编辑，正常恢复自动测量 */
  const measureCooldown = useRef(0)

  // 双指捏合 / Ctrl+滚轮：只缩放中间模板（接管浏览器整页缩放），锚点在指针位置
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey && !ev.metaKey) return
      ev.preventDefault()
      const old = zoomRef.current
      const dy = Math.max(-80, Math.min(80, ev.deltaY))
      const factor = Math.exp(-dy * 0.006)
      const next = Math.min(4, Math.max(0.2, Math.round(old * factor * 100) / 100))
      if (next === old) return
      const r = el.getBoundingClientRect()
      const ax = ev.clientX - r.left
      const ay = ev.clientY - r.top
      if (!pinchRef.current) pinchRef.current = { sx: el.scrollLeft, sy: el.scrollTop, zoom: old, ax, ay }
      zoomRef.current = next
      api.setZoom(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [api])

  useLayoutEffect(() => {
    const el = scrollRef.current
    const p = pinchRef.current
    if (!el || !p) return
    pinchRef.current = null
    const ratio = api.zoom / p.zoom
    const padL = el.firstElementChild ? (el.firstElementChild as HTMLElement).offsetLeft : 0
    const padT = el.firstElementChild ? (el.firstElementChild as HTMLElement).offsetTop : 0
    el.scrollLeft = padL + (p.sx + p.ax - padL) * ratio - p.ax
    el.scrollTop = padT + (p.sy + p.ay - padT) * ratio - p.ay
  }, [api.zoom])

  // —— 自动高度：测量每个文字块的真实内容高度，交给 store 回流 ——
  useLayoutEffect(() => {
    const root = scrollRef.current
    if (!root) return
    if (api.editingId || api.isTxActive()) return
    if (api.doc.flow?.autoHeight === false) return

    // 上一轮撞到上限、还在冷却里：这一段不量。冷却过了重新计数，
    // 元素级的闸还是有效的，所以不会二次跑回死循环。
    const now = Date.now()
    if (now < measureCooldown.current) return
    if (measureRounds.current > MAX_MEASURE_ROUNDS) measureRounds.current = 0

    const heights: Record<string, number> = {}
    const els = new Map<string, El>()
    for (const page of api.doc.pages) for (const el of page.els) els.set(el.id, el)

    let splitDone = false
    let clearId = ''
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('.ed-el[data-el-id]'))
    for (const node of nodes) {
      const id = node.dataset.elId
      const el = id ? els.get(id) : null
      if (!el || !isMeasurable(el)) continue
      if (api.editingId === el.id) continue
      // 手动锁过高度的元素（拖过上下手柄、或在属性面板里输入过「高」）也要测：
      // 内容装不下时必须向上长高，否则文字溢出框外、压住下面的内容
      const heightLocked = el.autoHeight === false
      const slot = node.querySelector<HTMLElement>('.ed-slot')
      if (!slot) continue

      const prev = slot.style.height
      slot.style.height = 'auto'
      const natural = Math.ceil(slot.offsetHeight)
      slot.style.height = prev
      if (natural <= 6) continue

      const pageNode = node.closest('.ed-page') as HTMLElement | null
      const pageIdx = Number(pageNode?.getAttribute('data-page-idx') ?? 0)
      const geom = getGeometry(api.doc, pageIdx)
      const textLike = SPLITTABLE_VARIANTS.has(el.variant)
      const pageRect = pageNode?.getBoundingClientRect()
      const slotRect = slot.getBoundingClientRect()
      // 以 DOM 实际位置判断是否跨页，避免 doc 与 DOM 在连续回流中短暂不同步
      const localTop = pageRect ? (slotRect.top - pageRect.top) / api.zoom : el.y
      const fits = localTop + natural <= geom.bottom + 1
      const startsAboveBottom = localTop >= -1 && localTop < geom.bottom - 16

      // 续块已经能装下：恢复正常流动
      if (el.noFlow && fits) {
        clearId = el.id
        break
      }

      // 文字块跨页：按整行切开，上半段留在原栏，下半段生成新组件接到下一栏
      if (textLike && !fits && startsAboveBottom && natural > 40) {
        const tries = splitTries.current.get(el.id) ?? 0
        if (tries >= MAX_SPLIT_TRIES) {
          // 切了这么多次仍然装不下：再切只会无限生出续块，直接把这一块放掉，让它溢出到页外
          if (tries === MAX_SPLIT_TRIES) {
            splitTries.current.set(el.id, tries + 1)
            console.warn('[paiban] 该块连续切分仍装不下，停止自动切分：', el.id, el.variant, el.h, natural)
          }
          continue
        }
        const cutoff = pageRect ? pageRect.top + geom.bottom * api.zoom : 0
        const payload = splitSlotAt(slot, cutoff, api.zoom, natural)
        if (payload) {
          splitDone = true
          splitTries.current.set(el.id, tries + 1)
          api.splitTextElement(el.id, payload)
          break
        }
        if (el.noFlow) {
          clearId = el.id
          break
        }
      }

      let wantHeight = heightLocked ? natural > el.h + 1 : Math.abs(natural - el.h) > 0.6
      // 已经顶满整栏：这块内容比一栏还高，版面上没地方给。写回去只会被 reflow 压回栏高
      // （layout.ts 里 `el.h > g.height` 那步），来回拉锯纯属白烧。这里直接不提议改高度。
      if (wantHeight && natural > el.h && el.h >= geom.height - 0.5) {
        wantHeight = false
        // 只说一次：这是内容量的问题，不是每帧都要提醒
        if (!overflowWarned.current.has(el.id)) {
          overflowWarned.current.add(el.id)
          console.warn(
            `[paiban] 该块内容比一栏还高 ${Math.round(natural - el.h)}px，已按栏高截断，多出的部分会压在框外：${el.id} (${el.variant})`,
          )
        }
      }
      if (!wantHeight) {
        // 这一轮量准了，把之前攒的失败次数清掉
        heightTries.current.delete(el.id)
        continue
      }
      const htries = heightTries.current.get(el.id) ?? 0
      if (htries >= MAX_HEIGHT_TRIES) {
        // 高度在几轮之间来回摆（自然高度和写回值互相拉扯）：锁定当前高度，别再改了
        if (htries === MAX_HEIGHT_TRIES) {
          heightTries.current.set(el.id, htries + 1)
          console.warn('[paiban] 该块高度反复量不准，锁定当前高度：', el.id, el.variant, el.h, natural)
        }
        continue
      }
      heightTries.current.set(el.id, htries + 1)
      heights[el.id] = natural
    }

    // 元素被删掉后计数表会留下孤儿项，顺手清掉
    splitTries.current.forEach((_, id) => {
      if (!els.has(id)) splitTries.current.delete(id)
    })
    heightTries.current.forEach((_, id) => {
      if (!els.has(id)) heightTries.current.delete(id)
    })

    if (splitDone) return
    if (clearId) {
      api.clearNoFlow(clearId)
      return
    }
    if (Object.keys(heights).length === 0) {
      // 这一轮没有要改的，说明收敛了，计数归零
      measureRounds.current = 0
      return
    }
    measureRounds.current += 1
    if (measureRounds.current > MAX_MEASURE_ROUNDS) {
      if (measureRounds.current === MAX_MEASURE_ROUNDS + 1) {
        console.warn('[paiban] 自动测量连续 %d 轮未收敛，暂停自动调整 300ms', MAX_MEASURE_ROUNDS)
        measureCooldown.current = Date.now() + 300
      }
      return
    }
    api.applyMeasuredHeights(heights)
  }, [api.doc, api.editingId, api.zoom, api])

  return (
    <div className="ed-canvas">
      <div className="ed-canvas-bar">
        <button
          className={api.drawMode ? 'is-on' : ''}
          onClick={() => api.setDrawMode(!api.drawMode)}
          data-tip="<b>框选区域</b>在页面上按网格拖出一块区域：落入其中的元素会被约束在区域内拖不出去"
        >
          ▭ 框选区域（按网格）
        </button>
        <div className="ed-zoom">
          <button title="缩小" data-tip="<b>缩小</b>把模板缩小 10%（也可双指捏合）" onClick={() => api.setZoom(Math.max(0.2, Math.round((api.zoom - 0.1) * 100) / 100))}>
            −
          </button>
          <span className="ed-zoom-val" data-tip="<b>当前缩放</b>只作用于中间模板，界面不变">
            {Math.round(api.zoom * 100)}%
          </span>
          <button title="放大" data-tip="<b>放大</b>把模板放大 10%（也可双指张开）" onClick={() => api.setZoom(Math.min(4, Math.round((api.zoom + 0.1) * 100) / 100))}>
            ＋
          </button>
          <button title="还原 100%" data-tip="<b>还原 100%</b>恢复实际大小" onClick={() => api.setZoom(1)}>
            100%
          </button>
          <span className="ed-hint">🔍 双指捏合 / Ctrl+滚轮缩放</span>
        </div>
        <span className="ed-hint">
          {api.drawMode
            ? '在页面上拖出一块区域：落入其中的元素会被约束在区域内'
            : '拖动移动 · Shift/Cmd 点选多块（空白拖框也可）· 右键拆块 / 合并 · Alt+方向键微调'}
        </span>
      </div>
      <div
        className="ed-canvas-scroll"
        ref={scrollRef}
        onContextMenu={(e) => {
          // 事件委托：不用给每个元素都挂 handler
          const node = (e.target as HTMLElement).closest('[data-el-id]') as HTMLElement | null
          const id = node?.dataset.elId
          if (!id) return
          e.preventDefault()
          /* 右键点的是已选中的块 → 保留整组多选（这样才能右键合并）；
           * 点的是别的块 → 改成单选它。 */
          const keep = api.selectedIds.includes(id)
          if (!keep) api.setSelection(id)
          const ids = keep ? api.selectedIds : [id]
          setMenu({ x: e.clientX, y: e.clientY, id, ids })
        }}
      >
        {api.doc.pages.map((p, i) => (
          <PageView
            key={p.id}
            api={api}
            pageIdx={i}
            dropTarget={dragPage === i}
            isLast={i === api.doc.pages.length - 1}
            onHoverPage={setDragPage}
            onGhost={setDragGhost}
          />
        ))}
        {dragPage === api.doc.pages.length && <div className="ed-drop-new-page">松手新建第 {dragPage + 1} 页</div>}
        <button className="ed-add-page" onClick={api.addPage} data-tip="<b>新增一页</b>在文档末尾追加一页（自动带页眉/页脚）">
          ＋ 新增一页
        </button>

        {menu && (() => {
          const el = api.findEl(menu.id)
          if (!el) return null
          const parts = countParts(el.html ?? '')
          const flowing = el.kind === 'text' || el.kind === 'box'
          const group = menu.ids.map((id) => api.findEl(id)).filter((x): x is El => !!x)
          // 能合并的：同 kind、同 variant、不是锁定件
          const mergeable = group.filter((x) => !x.locked && x.kind === el.kind && x.variant === el.variant)

          /* —— 多选（2 块以上）：合并 / 批量拆 / 批量删 —— */
          if (group.length > 1) {
            const items: MenuItem[] = [
              { head: `已选 ${group.length} 块` },
              {
                label: '合并为一块',
                hint: mergeable.length > 1 ? `可并 ${mergeable.length} 块` : '无同类型块',
                disabled: mergeable.length < 2,
                onClick: () => {
                  const r = api.mergeElements(menu.ids)
                  if (r.skipped) {
                    popNotice({
                      tone: 'warn',
                      title: `已合并 ${r.ok} 块，跳过 ${r.skipped} 块`,
                      notes: ['不同类型（组件样式不同）的块不能拼在一起，已原样保留'],
                      hint: '想一起合并的话，先在属性面板把它们的组件样式改成一致',
                    })
                  }
                },
              },
              { sep: true },
              { label: '每块按段落拆开', hint: '批量', onClick: () => api.splitElements(menu.ids, 'nodes') },
              { label: '每块均分成 2 块', onClick: () => api.splitElements(menu.ids, 'count', { parts: 2 }) },
              { sep: true },
              { label: `删除这 ${group.length} 块`, onClick: () => api.removeSelected() },
            ]
            return <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
          }

          /* —— 单选 —— */
          const items: MenuItem[] = [
            {
              label: '按段落拆成多块',
              hint: `${parts} 段`,
              disabled: parts < 2,
              onClick: () => api.splitElement(el.id, 'nodes'),
            },
            { label: '均分成 2 块', disabled: parts < 2, onClick: () => api.splitElement(el.id, 'count', { parts: 2 }) },
            { label: '均分成 3 块', disabled: parts < 3, onClick: () => api.splitElement(el.id, 'count', { parts: 3 }) },
            { label: '按约 420 字均分', disabled: parts < 2, onClick: () => api.splitElement(el.id, 'chars', { chunkChars: 420 }) },
            {
              label: '从选中的内部元素处切开',
              disabled: parts < 2 || api.subSelection?.elId !== el.id,
              onClick: () => api.splitElement(el.id, 'at'),
            },
            { sep: true },
            {
              label: '与下一块合并',
              hint: '同栏同类型',
              disabled: !flowing,
              onClick: () => {
                if (!api.mergeWithNext(el.id)) {
                  popNotice({
                    tone: 'warn',
                    title: '下一块类型不同，合并不了',
                    hint: '按住 Cmd / Ctrl 点选多块，再右键「合并为一块」可以一次拼起来',
                  })
                }
              },
            },
            { sep: true },
            { label: '复制一份', onClick: () => api.duplicateEl(el.id) },
            { label: el.locked ? '解锁' : '锁定位置', onClick: () => api.toggleLock(el.id) },
            { label: '删除', onClick: () => api.removeEl(el.id) },
          ]
          return <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
        })()}
        {dragGhost && (() => {
          const gel = api.findEl(dragGhost.id)
          if (!gel) return null
          return (
            <div
              className="ed-drag-ghost"
              style={{ left: dragGhost.x + 14, top: dragGhost.y + 14, width: gel.w * api.zoom, height: gel.h * api.zoom }}
            >
              <div className="ed-page" style={{ width: gel.w, height: gel.h, transform: `scale(${api.zoom})` }}>
                <ElContent el={gel} />
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
