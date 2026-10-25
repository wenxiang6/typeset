/** 富文本/排版格式化工具（行内格式 + 元素级格式） */

export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: '宋体', value: '"Songti SC","SimSun",serif' },
  { label: '黑体', value: '"Lantinghei SC","PingFang SC","SimHei",sans-serif' },
  { label: '楷体', value: '"Kaiti SC","KaiTi",serif' },
  { label: '仿宋', value: '"FangSong","STFangsong",serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei",sans-serif' },
  { label: 'Arial', value: 'Arial,sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman",serif' },
]

export const FONT_SIZES = [9, 10, 10.5, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 42, 48, 54, 60, 72]

export const LINE_HEIGHTS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3]

export const LETTER_SPACINGS = [
  { label: '紧缩 -0.1em', value: '-0.1em' },
  { label: '正常', value: '0' },
  { label: '加宽 0.1em', value: '0.1em' },
  { label: '加宽 0.2em', value: '0.2em' },
  { label: '加宽 0.4em', value: '0.4em' },
]

export const PRESET_COLORS = [
  '#000000', '#333333', '#666666', '#999999', '#cccccc', '#ffffff',
  '#e60012', '#ff4d4f', '#ff7a45', '#faad14', '#fadb14', '#52c41a',
  '#13c2c2', '#1677ff', '#2f54eb', '#722ed1', '#eb2f96', '#7a4b2a',
]

export function activeEditable(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null
  return el && el.isContentEditable ? el : null
}

/** 记住最近一次在可编辑区内的选区（工具栏按钮抢焦点后仍可恢复） */
let savedRange: Range | null = null

export function rememberSelection() {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  const node = range.commonAncestorContainer as HTMLElement
  const host = (node.nodeType === 1 ? node : node.parentElement)?.closest('.ed-live')
  if (host) savedRange = range.cloneRange()
}

export function clearSavedSelection() {
  savedRange = null
}

function restoreSelection() {
  const sel = window.getSelection()
  if (!sel) return
  if (sel.isCollapsed && savedRange) {
    sel.removeAllRanges()
    sel.addRange(savedRange)
  }
}

function wrapRange(tag: string, style?: string) {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  const node = document.createElement(tag)
  if (style) node.setAttribute('style', style)
  try {
    range.surroundContents(node)
  } catch {
    const frag = range.extractContents()
    node.appendChild(frag)
    range.insertNode(node)
  }
  sel.removeAllRanges()
  const next = document.createRange()
  next.selectNodeContents(node)
  sel.addRange(next)
}

function onlyEditable(fn: () => void) {
  restoreSelection()
  if (!activeEditable()) return
  fn()
  rememberSelection()
}

export function inlineBold() {
  onlyEditable(() => wrapRange('b'))
}
export function inlineItalic() {
  onlyEditable(() => wrapRange('i'))
}
export function inlineUnderline() {
  onlyEditable(() => wrapRange('u'))
}
export function inlineStrike() {
  onlyEditable(() => wrapRange('s'))
}
export function inlineColor(color: string) {
  onlyEditable(() => wrapRange('span', `color:${color}`))
}
export function inlineHighlight(color: string) {
  onlyEditable(() => wrapRange('span', `background-color:${color}`))
}
export function inlineFontFamily(family: string) {
  onlyEditable(() => wrapRange('span', `font-family:${family}`))
}
export function inlineFontSize(px: number) {
  onlyEditable(() => wrapRange('span', `font-size:${px}px`))
}
export function inlineClear() {
  onlyEditable(() => document.execCommand('removeFormat'))
}
export function inlineList(ordered: boolean) {
  onlyEditable(() => document.execCommand(ordered ? 'insertOrderedList' : 'insertUnorderedList'))
}

/** 光标处插入文本（图片说明、分隔线等） */
export function insertText(text: string) {
  onlyEditable(() => document.execCommand('insertText', false, text))
}

export function exportJSON(data: unknown, filename = 'paiban-doc.json') {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
