export type ListType = 'ul' | 'ol'

export interface ListModel {
  type: ListType
  style: string
  items: string[]
}

export const UL_TEMPLATES = [
  { value: 'disc', label: '圆点' },
  { value: 'circle', label: '空心圆' },
  { value: 'square', label: '方块' },
  { value: 'check', label: '对勾' },
  { value: 'arrow', label: '箭头' },
  { value: 'dash', label: '短横' },
  { value: 'columns', label: '双列' },
  { value: 'cards', label: '卡片' },
]

export const OL_TEMPLATES = [
  { value: 'decimal', label: '数字' },
  { value: 'leading-zero', label: '前导零' },
  { value: 'lower-alpha', label: '字母' },
  { value: 'lower-roman', label: '罗马' },
  { value: 'cjk', label: '中文' },
  { value: 'paren', label: '括号' },
  { value: 'circle-number', label: '带圈数字' },
  { value: 'bignum', label: '大号数字' },
]

export function defaultStyle(type: ListType): string {
  return type === 'ul' ? 'disc' : 'decimal'
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function parseList(html?: string): ListModel | null {
  if (!html) return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.body.firstElementChild
  if (!root || (root.tagName !== 'UL' && root.tagName !== 'OL')) return null
  const type: ListType = root.tagName === 'OL' ? 'ol' : 'ul'
  const style = root.getAttribute('data-list-style') || defaultStyle(type)
  const items = Array.from(root.querySelectorAll(':scope > li')).map((li) => (li.textContent || '').trim())
  return { type, style, items: items.length ? items : [''] }
}

export function buildList(model: ListModel): string {
  const tag = model.type
  const items = model.items.map((t) => `<li>${esc(t)}</li>`).join('')
  return `<${tag} class="w-list" data-list-style="${esc(model.style)}">${items}</${tag}>`
}

export function switchListType(model: ListModel, type: ListType): ListModel {
  const valid = (type === 'ul' ? UL_TEMPLATES : OL_TEMPLATES).some((t) => t.value === model.style)
  return { ...model, type, style: valid ? model.style : defaultStyle(type) }
}
