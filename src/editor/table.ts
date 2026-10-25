export interface TableModel {
  headers: string[]
  rows: string[][]
  /** 列宽百分比，总和 100 */
  widths: number[]
  /** 表头 + 每行高度（px，0 表示自适应） */
  heights: number[]
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 从组件 HTML 解析表格；不是表格返回 null */
export function parseTable(html?: string): TableModel | null {
  if (!html) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = doc.querySelector('table')
  if (!table) return null

  const headRow = table.querySelector('thead tr')
  const headCells = headRow ? Array.from(headRow.querySelectorAll('th, td')) : []
  const bodyRows = Array.from(table.querySelectorAll('tbody tr'))
  const headers = headCells.map((c) => (c.textContent || '').trim())
  const rows = bodyRows.map((tr) => Array.from(tr.querySelectorAll('td, th')).map((c) => (c.textContent || '').trim()))

  const cols = Math.max(1, headers.length, ...rows.map((r) => r.length))
  while (headers.length < cols) headers.push('')
  const normalizedRows = rows.length
    ? rows.map((r) => {
        const next = [...r]
        while (next.length < cols) next.push('')
        return next.slice(0, cols)
      })
    : [Array.from({ length: cols }, () => '')]

  const colEls = Array.from(table.querySelectorAll('colgroup col')) as HTMLElement[]
  let widths = colEls.map((c) => parseFloat(c.style.width || '')).filter((n) => isFinite(n) && n > 0)
  if (widths.length !== cols || Math.abs(widths.reduce((a, b) => a + b, 0) - 100) > 0.5) {
    widths = Array.from({ length: cols }, () => 100 / cols)
  }
  const trs = [headRow, ...bodyRows].filter(Boolean) as HTMLTableRowElement[]
  const heights = trs.map((tr) => parseFloat(tr.style.height || '') || 0)

  return { headers, rows: normalizedRows, widths, heights }
}

function normalizeWidths(widths: number[], cols: number): number[] {
  const next = Array.from({ length: cols }, (_, i) => widths[i] ?? 100 / cols)
  const sum = next.reduce((a, b) => a + b, 0) || 100
  return next.map((w) => (w / sum) * 100)
}

export function buildTable(model: TableModel): string {
  const cols = model.headers.length
  const widths = normalizeWidths(model.widths, cols)
  const heights = model.heights
  const headH = heights[0] ? ` style="height:${Math.round(heights[0])}px"` : ''
  const headers = model.headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const rows = model.rows
    .map((row, i) => {
      const h = heights[i + 1] ? ` style="height:${Math.round(heights[i + 1])}px"` : ''
      return `<tr${h}>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`
    })
    .join('')
  const colsHtml = widths.map((w) => `<col style="width:${Math.round(w * 100) / 100}%">`).join('')
  return `<div class="w-table"><table><colgroup>${colsHtml}</colgroup><thead><tr${headH}>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`
}

export function resizeRows(model: TableModel, delta: number, newRowHeight = 0): TableModel {
  const count = Math.max(1, model.rows.length + delta)
  const rows = model.rows.slice(0, count)
  while (rows.length < count) rows.push(Array.from({ length: model.headers.length }, () => ''))
  const heights = model.heights.slice(0, count + 1)
  while (heights.length < count + 1) heights.push(0)
  if (delta > 0) {
    // 新行沿用上一行高度；newRowHeight 是从画布量到的真实高度
    heights[count] = newRowHeight || heights[count - 1] || 0
  }
  return { headers: [...model.headers], rows, widths: [...model.widths], heights }
}

export function resizeCols(model: TableModel, delta: number): TableModel {
  const count = Math.max(1, model.headers.length + delta)
  return {
    headers: Array.from({ length: count }, (_, i) => model.headers[i] ?? ''),
    rows: model.rows.map((r) => Array.from({ length: count }, (_, i) => r[i] ?? '')),
    widths: normalizeWidths(model.widths, count),
    heights: [...model.heights],
  }
}

export function setHeader(model: TableModel, col: number, value: string): TableModel {
  const headers = [...model.headers]
  headers[col] = value
  return { ...model, headers }
}

export function setCell(model: TableModel, row: number, col: number, value: string): TableModel {
  const rows = model.rows.map((r) => [...r])
  rows[row][col] = value
  return { ...model, rows }
}


export function setColWidth(model: TableModel, index: number, width: number): TableModel {
  const widths = normalizeWidths(model.widths, model.headers.length)
  const next = Math.max(5, Math.min(95, width))
  const other = widths[index + 1]
  if (other === undefined) return model
  const delta = next - widths[index]
  const nextOther = Math.max(5, other - delta)
  widths[index] = 100 - widths.reduce((s, w, i) => (i === index || i === index + 1 ? s : s + w), 0) - nextOther
  widths[index + 1] = nextOther
  return { ...model, widths: normalizeWidths(widths, model.headers.length) }
}

export function setRowHeight(model: TableModel, index: number, height: number): TableModel {
  const heights = [...model.heights]
  while (heights.length < model.rows.length + 1) heights.push(0)
  heights[index] = Math.max(18, height)
  return { ...model, heights }
}
