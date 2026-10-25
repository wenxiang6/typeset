import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { El } from './types'
import type { EditorApi } from './store'
import { findRegion, getGeometry, isFurniture, isMeasurable, resolveMove } from './layout'
import { resolveImageSrc } from './localImage'
import { TableHandles } from './TableHandles'

const HANDLES = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as const

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
  const editing = api.editingId === el.id
  const ref = useRef<HTMLDivElement>(null)

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
      if (el.locked || editing) return
      e.stopPropagation()
      e.preventDefault()

      const doc0 = api.getDoc()
      const live = doc0.pages[pageIdx]?.els.find((x) => x.id === el.id) ?? el
      const furniture = isFurniture(live)
      api.setSelection(el.id)
      api.setSubSelection(null)
      api.beginTx()

      // 拖动中的组件必须置顶，否则会被高层级的不透明块“吃掉”，看起来像消失
      if (live.kind !== 'region') {
        const maxZ = Math.max(0, ...(doc0.pages[pageIdx]?.els ?? []).map((x) => x.z))
        if (live.z < maxZ) api.updateEl(el.id, { z: maxZ + 1 }, false)
      }

      const node = ref.current
      node?.classList.add('is-dragging')

      const targetEl = e.currentTarget as HTMLElement
      const startX = e.clientX
      const startY = e.clientY
      const orig = { x: live.x, y: live.y, w: live.w, h: live.h }
      // 拖动起点所在区域决定约束：元素在区域内时不会被拖出区域
      const regionEl = live.kind === 'region' ? null : findRegion(doc0, pageIdx, orig, el.id)
      const region = regionEl ? { x: regionEl.x, y: regionEl.y, w: regionEl.w, h: regionEl.h } : null
      let last = orig
      let lastClientY = e.clientY
      let lastTarget = pageIdx

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
          node?.classList.toggle('is-ghosted', crossPage)
          onHoverPage?.(crossPage ? lastTarget : null)
          if (crossPage) {
            // 指针已经在其他页/新页上：源页不再继续推挤，改为跟随指针的浮层预览
            onGhost?.({ id: el.id, x: ev.clientX, y: ev.clientY })
            return
          }
          onGhost?.(null)
        } else {
          lastTarget = pageIdx
          node?.classList.remove('is-ghosted')
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
        res.pushed.forEach((rect, pid) => api.updateEl(pid, rect, false))
      }

      const up = (ev: PointerEvent) => {
        try {
          targetEl.releasePointerCapture?.(e.pointerId)
        } catch {
          /* 合成事件无捕获 */
        }
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        node?.classList.remove('is-dragging')

        onHoverPage?.(null)
        onGhost?.(null)
        node?.classList.remove('is-ghosted')
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
      className={`ed-el ed-kind-${el.kind} ed-v-${el.variant}${s.background ? ' has-custom-bg' : ''}${selected ? ' is-selected' : ''}${el.locked ? ' is-locked' : ''}${editing ? ' is-editing' : ''}`}
      style={style}
      onPointerDown={(e) => {
        if (editing || api.drawMode) return
        // 点选组件时把焦点从输入框/下拉框移开，方向键才能微调组件
        const ae = document.activeElement as HTMLElement | null
        if (ae && ae !== document.body && !e.currentTarget.contains(ae)) ae.blur()
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
        if (el.kind === 'image' || el.kind === 'region' || el.locked) return
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

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    api.setPageIdx(pageIdx)
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
      api.setSelection(null)
      api.setEditingId(null)
      return
    }
    e.preventDefault()
    const rect = pageRef.current!.getBoundingClientRect()
    const sx = (e.clientX - rect.left) / zoom
    const sy = (e.clientY - rect.top) / zoom
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
        {band && <div className="ed-band" style={{ left: band.x, top: band.y, width: band.w, height: band.h }} />}
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
  const zoomRef = useRef(api.zoom)
  zoomRef.current = api.zoom
  // 捏合锚点：记住手势起点的滚动/缩放基准，缩放生效后一次校正（批量事件也精确）
  const pinchRef = useRef<{ sx: number; sy: number; zoom: number; ax: number; ay: number } | null>(null)

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

    const heights: Record<string, number> = {}
    const els = new Map<string, El>()
    for (const page of api.doc.pages) for (const el of page.els) els.set(el.id, el)

    let splitDone = false
    let clearId = ''
    const nodes = Array.from(root.querySelectorAll<HTMLElement>('.ed-el[data-el-id]'))
    for (const node of nodes) {
      const id = node.dataset.elId
      const el = id ? els.get(id) : null
      if (!el || !isMeasurable(el) || el.autoHeight === false) continue
      if (api.editingId === el.id) continue
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
      const textLike = el.kind === 'text' || (el.kind === 'box' && el.variant !== 'table' && el.variant !== 'qr')
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
        const cutoff = pageRect ? pageRect.top + geom.bottom * api.zoom : 0
        const payload = splitSlotAt(slot, cutoff, api.zoom, natural)
        if (payload) {
          splitDone = true
          api.splitTextElement(el.id, payload)
          break
        }
        if (el.noFlow) {
          clearId = el.id
          break
        }
      }

      if (Math.abs(natural - el.h) > 0.6) heights[el.id] = natural
    }

    if (splitDone) return
    if (clearId) {
      api.clearNoFlow(clearId)
      return
    }
    if (Object.keys(heights).length === 0) return
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
          {api.drawMode ? '在页面上拖出一块区域：落入其中的元素会被约束在区域内' : '拖动移动 · 拖到其他页可跨页 · 松手自动补齐/翻页'}
        </span>
      </div>
      <div className="ed-canvas-scroll" ref={scrollRef}>
        {api.doc.pages.map((_, i) => (
          <PageView key={i} api={api} pageIdx={i} dropTarget={dragPage === i} isLast={i === api.doc.pages.length - 1} onHoverPage={setDragPage} onGhost={setDragGhost} />
        ))}
        {dragPage === api.doc.pages.length && <div className="ed-drop-new-page">松手新建第 {dragPage + 1} 页</div>}
        <button className="ed-add-page" onClick={api.addPage} data-tip="<b>新增一页</b>在文档末尾追加一页（自动带页眉/页脚）">
          ＋ 新增一页
        </button>
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
