import { useLayoutEffect, useRef, useState } from 'react'
import type { El } from './types'
import type { EditorApi } from './store'
import { buildTable, parseTable, setColWidth, setRowHeight } from './table'

interface Measure {
  tableLeft: number
  tableTop: number
  tableW: number
  tableH: number
  cols: number[]
  rows: number[]
  rowHeights: number[]
}

/**
 * 选中表格后，在列线/行线上显示拖拽把手：
 * - 左右拖列线：调整相邻两列宽度
 * - 上下拖行线：调整该行高度
 */
export function TableHandles({ el, api, hostRef }: { el: El; api: EditorApi; hostRef: React.RefObject<HTMLDivElement | null> }) {
  const [measure, setMeasure] = useState<Measure | null>(null)
  const dragging = useRef(false)

  useLayoutEffect(() => {
    const host = hostRef.current
    const table = host?.querySelector('table') as HTMLTableElement | null
    if (!host || !table) {
      setMeasure(null)
      return
    }
    const hr = host.getBoundingClientRect()
    const tr = table.getBoundingClientRect()
    const zoom = api.zoom || 1
    const headCells = Array.from(table.querySelectorAll('thead th')) as HTMLElement[]
    const trs = Array.from(table.querySelectorAll('tr')) as HTMLTableRowElement[]
    setMeasure({
      tableLeft: (tr.left - hr.left) / zoom,
      tableTop: (tr.top - hr.top) / zoom,
      tableW: tr.width / zoom,
      tableH: tr.height / zoom,
      cols: headCells.slice(0, -1).map((c) => (c.getBoundingClientRect().right - hr.left) / zoom),
      rows: trs.map((r) => (r.getBoundingClientRect().bottom - hr.top) / zoom),
      rowHeights: trs.map((r) => r.getBoundingClientRect().height / zoom),
    })
  }, [hostRef, el.html, el.w, el.h, api.zoom, api.selection])

  if (!measure || api.selection !== el.id) return null

  const start = (type: 'col' | 'row', index: number, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const base = parseTable(el.html)
    if (!base || dragging.current) return
    dragging.current = true
    const startX = e.clientX
    const startY = e.clientY
    const tableW = Math.max(1, measure.tableW)
    const baseH = base.heights[index] || measure.rowHeights[index] || 24
    api.beginTx()

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / api.zoom
      const dy = (ev.clientY - startY) / api.zoom
      const next =
        type === 'col'
          ? setColWidth(base, index, base.widths[index] + (dx / tableW) * 100)
          : setRowHeight(base, index, baseH + dy)
      api.updateEl(el.id, { html: buildTable(next) }, false)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragging.current = false
      api.endTx()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
  }

  return (
    <div className="ed-table-handles" aria-hidden>
      {measure.cols.map((x, i) => (
        <i
          key={`c-${i}`}
          className="ed-th-v"
          style={{ left: x, top: measure.tableTop, height: measure.tableH }}
          onPointerDown={(e) => start('col', i, e)}
          title="拖动调整列宽"
        />
      ))}
      {measure.rows.map((y, i) => (
        <i
          key={`r-${i}`}
          className="ed-th-h"
          style={{ top: y, left: measure.tableLeft, width: measure.tableW }}
          onPointerDown={(e) => start('row', i, e)}
          title="拖动调整行高"
        />
      ))}
    </div>
  )
}
