/**
 * 语义块 → 编辑器组件（El）。
 *
 * HTML 模板全部复用 tools/import/rules.mjs 里那套（H / EL），
 * 所以「AI 写的语义 JSON」和「Word 导进来的稿子」出来的是同一种组件、同一套 CSS，
 * 不存在两套样式各自漂移的问题。
 */
import { H, EL, esc } from '../import/rules.mjs'

/**
 * 纯文本 → 行内 HTML。
 * 只支持两个记号，够用且不容易写坏：
 *   **粗体**   → <b>
 *   换行       → <br>（连续两个换行 = 分段）
 */
export function rich(text) {
  const safe = String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return safe
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\n{2,}/g, '<br><br>')
    .replace(/\n/g, '<br>')
}

/** 块内容（html 直通优先，否则 text 转行内 html） */
const body = (b) => b.html || rich(b.text)

/** html 是否已经是「完整组件」（带容器标签），是就直接用，不再包一层 */
const isFullHtml = (h) => /^\s*<(div|p|ul|ol|table|h[1-6])\b/i.test(String(h ?? ''))

/** 每种语义块对应的组件类型与样式变体 */
const KIND = {
  section: 'chrome',
  para: 'text',
  lead: 'text',
  subhead: 'text',
  note: 'box',
  concept: 'box',
  trap: 'box',
  req: 'text',
  chain: 'box',
  tpl: 'box',
  quiz: 'box',
  list: 'box',
  table: 'box',
  image: 'image',
  'name-row': 'box',
}
const VARIANT = {
  section: 'section-title',
  para: 'paragraph',
  lead: 'lead',
  subhead: 'subhead',
  note: 'note',
  concept: 'concept',
  trap: 'trap',
  req: 'req',
  chain: 'chain',
  tpl: 'tpl',
  quiz: 'quiz',
  table: 'table',
  image: 'image',
  'name-row': 'name-row',
}
/**
 * 默认跨栏的块：留空。
 *
 * 曾经把 table 设成跨栏，结果编辑器 reflow 时对 span 块与单栏块混排处理不好
 * （后面的块会被压回 span 块的 y，实测和表格重叠 109px）。稳妥起见一律单栏，
 * 真要跨栏就在块里显式写 "full": true，并自己确认那一页其它块的位置。
 */
const FULL = new Set()

/** 报头（首页）*/
export function mastheadHtml(meta) {
  const sub = meta.sub ? esc(meta.sub) : '\u00a0'
  return (
    `<div class="masthead">` +
    (meta.kicker ? `<div class="kicker">${esc(meta.kicker)}</div>` : '') +
    `<h1>${esc(meta.title)}</h1>` +
    `<div class="sub">${sub}</div>` +
    `</div>`
  )
}

/** 页眉（每页）*/
export function headerHtml(meta) {
  return (
    `<div class="header"><div class="header-left"><div class="header-title">${esc(meta.journal)} <span>${esc(
      meta.en,
    )}</span></div></div><div class="header-right"><div class="issue">${esc(meta.issue)}</div><div>${esc(
      meta.date,
    )}</div></div></div>`
  )
}

/** 页脚（每页，页码按页生成）*/
export function footerHtml(meta, pageNo, total) {
  return (
    `<div class="footer"><div class="footer-top"><span>${esc(meta.sloganLeft)}</span>` +
    `<span class="center">— ${pageNo} / ${total} —</span>` +
    `<span>${esc(meta.sloganRight)}</span></div><div class="footer-bottom">` +
    `<span>使用日期：${esc(meta.date)}</span><span>编辑：${esc(meta.editor || '—')}</span>` +
    `<span>核对：${esc(meta.proofreader || '—')}</span></div></div>`
  )
}

/** 习题框：题干 / 选项 / 答案 / 解析 */
function quizInner(b) {
  const parts = []
  if (b.title) parts.push(`<p><strong>${rich(b.title)}</strong></p>`)
  for (const it of b.items) {
    if (it.html) {
      parts.push(it.html)
      continue
    }
    const no = it.no ? `${esc(it.no)}. ` : ''
    if (it.text) parts.push(`<p><strong>${no}${rich(it.text)}</strong></p>`)
    if (it.options?.length) parts.push(`<p>${it.options.map((o) => rich(o)).join('<br>')}</p>`)
    if (it.answer || it.exp) {
      const ans = it.answer ? `<span class="ans">答案：${rich(it.answer)}</span>` : ''
      const exp = it.exp ? ` <span class="exp">解析：${rich(it.exp)}</span>` : ''
      parts.push(`<p>${ans}${exp}</p>`)
    }
  }
  return parts.join('')
}

/** 模板框：标题 + 若干段（可带 label 前缀）*/
function tplInner(b) {
  return b.paras
    .map((p) => {
      if (p.html) return p.html
      return p.label ? H.label(p.label, rich(p.text)) : H.para(rich(p.text))
    })
    .join('')
}

/** 列表 */
function listHtml(b) {
  const tag = b.ordered ? 'ol' : 'ul'
  const style = b.ordered ? 'decimal' : 'disc'
  return `<${tag} class="w-list" data-list-style="${style}">${b.items.map((t) => `<li>${rich(t)}</li>`).join('')}</${tag}>`
}

/** 表格（列宽均分，编辑器里可以再拖）*/
function tableHtml(b) {
  const cols = Math.max(b.head.length, ...b.rows.map((r) => r.length), 1)
  const width = Math.round((100 / cols) * 100) / 100
  const colHtml = Array.from({ length: cols }, () => `<col style="width:${width}%">`).join('')
  const head = b.head.length
    ? `<thead><tr>${Array.from({ length: cols }, (_, i) => `<th>${esc(b.head[i] ?? '')}</th>`).join('')}</tr></thead>`
    : ''
  const bodyRows = b.rows
    .map((r) => `<tr>${Array.from({ length: cols }, (_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`)
    .join('')
  return `<div class="w-table"><table><colgroup>${colHtml}</colgroup>${head}<tbody>${bodyRows}</tbody></table></div>`
}

/**
 * 单个语义块 → 组件描述（不含坐标；kind/variant/html/src 齐了）
 * @returns {{kind:string, variant:string, html?:string, src?:string, full?:boolean}}
 */
export function blockToEl(b) {
  // 完整组件 html 直通：只补 kind / variant / 跨栏标记
  if (b.html && isFullHtml(b.html)) {
    return {
      kind: KIND[b.type] ?? 'box',
      variant: b.type === 'list' ? (b.ordered ? 'olist' : 'ulist') : VARIANT[b.type] ?? 'paragraph',
      html: b.html,
      src: b.src,
      ratio: b.ratio,
      full: b.full === true || FULL.has(b.type),
    }
  }

  switch (b.type) {
    case 'section':
      // 不要跨栏：编辑器 compactPage 把 span / 左栏 / 右栏 分三组独立堆叠，
      // 跨栏块会压在两栏内容上面（实测重叠 23px，正好是章节条的高度）
      return { ...EL.section(H.section(b.no, b.title)) }

    case 'para':
      return { ...EL.paragraph(b.html || (b.label ? H.label(b.label, rich(b.text)) : H.para(rich(b.text)))) }

    case 'lead':
      return { kind: 'text', variant: 'lead', html: `<div class="w-lead">${body(b)}</div>` }

    case 'subhead':
      return { ...EL.subhead(H.h3(body(b))) }

    case 'note':
      return { ...EL.note(H.note(body(b))) }

    case 'concept':
      return { ...EL.concept(H.concept(b.name, body(b))) }

    case 'trap':
      return { ...EL.trap(H.trap(body(b))) }

    case 'req':
      return { ...EL.req(H.req(body(b))) }

    case 'chain':
      return { ...EL.chain(H.chain(b.nodes.join(' → '))) }

    case 'tpl':
      return { ...EL.tpl(H.tpl(b.title, tplInner(b))) }

    case 'quiz':
      return { ...EL.quiz(H.quiz(quizInner(b))) }

    case 'list':
      return { kind: 'box', variant: b.ordered ? 'olist' : 'ulist', html: listHtml(b) }

    case 'table':
      return { kind: 'box', variant: 'table', html: tableHtml(b), full: b.full === true }

    case 'image':
      return { ...EL.image(H.image(b.src, b.ratio)), src: b.src, ratio: b.ratio, caption: b.caption, full: b.full }

    case 'name-row':
      return { ...EL.nameRow(H.nameRow()) }

    default:
      return null
  }
}
