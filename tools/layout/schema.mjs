/**
 * 语义版面 JSON：schema 定义 + 校验 + 归一化。
 *
 * 设计原则（为什么不让 AI 直接写坐标）：
 * - 坐标是「排版结果」，不是「内容」。让模型写 x/y 它必然算错（我们试过，一页 26 个块，
 *   上下左右互相压住，页底溢出 200px）。
 * - 所以这一层只描述「这是什么内容、按什么顺序、要不要框」，几何全部交给
 *   tools/layout/geometry.mjs 用真实栏宽算出来。模型只需要会写 type + text。
 *
 * 兼容性：`html` 字段永远可以直接塞原生 HTML（威力最大，但模型容易写坏样式）；
 * `text` 走纯文本 + 极简标记（**粗体**、\n 换行），90% 的场景够用。
 */

/** 允许的块类型 —— 白名单，写错会被报出来而不是悄悄丢掉 */
export const BLOCK_TYPES = [
  'section', // 章节标题：黑底编号块 + 粗标题 + 下横线
  'para', // 正文段落
  'lead', // 导语（左侧粗竖线）
  'subhead', // 小标题（h3）
  'note', // 灰底提示框
  'concept', // 概念框：名称加粗 + 内容
  'trap', // 易错条：✕ 开头
  'chain', // 因果链：A → B → C
  'req', // 学习要求学生框
  'tpl', // 答题模板：2px 粗边框
  'quiz', // 习题框
  'list', // 有序/无序列表
  'table', // 表格
  'image', // 配图
  'name-row', // 姓名 / 学号行
]

const ORIENTATIONS = ['landscape', 'portrait']

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (v === undefined || v === null ? '' : String(v))
const arr = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])

/** 有没有实际内容（用来跳过空块） */
function hasContent(b) {
  if (!isObj(b)) return false
  if (str(b.html).trim() || str(b.text).trim()) return true
  if (arr(b.items).length || arr(b.paras).length || arr(b.nodes).length || arr(b.rows).length) return true
  if (b.type === 'name-row') return true
  if (b.type === 'image' && b.src) return true
  return false
}

function normMeta(meta) {
  const m = isObj(meta) ? meta : {}
  return {
    journal: str(m.journal) || '地理时政周刊',
    en: str(m.en) || 'GEO WEEKLY',
    kicker: str(m.kicker) || str(m.issue) || '期刊一',
    title: str(m.title) || '地理时政周刊',
    sub: str(m.sub) || '',
    issue: str(m.issue) || str(m.kicker) || '期刊一',
    date: str(m.date) || '',
    editor: str(m.editor) || '',
    proofreader: str(m.proofreader) || '',
    sloganLeft: str(m.sloganLeft) || '尺幅千里，卷纳乾坤',
    sloganRight: str(m.sloganRight) || '思接寰宇，笔绘山河',
    watermark: str(m.watermark) || '',
    /** 报头是否生成（极少数情况要手放报头组件） */
    masthead: m.masthead !== false,
  }
}

/** 单个块的字段归一化（不改内容，只保证形状） */
function normBlock(b, warnings, idx) {
  const type = str(b.type).trim()
  const where = `blocks[${idx}]`
  if (!BLOCK_TYPES.includes(type)) {
    warnings.push(`${where}：未知 type「${type}」，已跳过（可用：${BLOCK_TYPES.join(' / ')}）`)
    return null
  }

  const base = { type }
  const text = str(b.text)
  const html = str(b.html)
  if (text) base.text = text
  if (html) base.html = html
  if (b.label) base.label = str(b.label)

  switch (type) {
    case 'section':
      base.no = str(b.no)
      base.title = str(b.title) || text
      // html 直通时标题就在 html 里，不需要 title 字段
      if (!base.title && !base.html) {
        warnings.push(`${where}：section 缺少 title（或给 html）`)
        return null
      }
      return base

    case 'para':
    case 'lead':
    case 'subhead':
    case 'note':
    case 'req':
    case 'trap':
      if (!base.text && !base.html) {
        warnings.push(`${where}：${type} 没有 text / html`)
        return null
      }
      return base

    case 'concept':
      base.name = str(b.name)
      // 允许直接塞整段 html（从旧稿反推、或模型想精确控制时用）
      if (base.html) return base
      if (!base.name || !base.text) {
        warnings.push(`${where}：concept 需要 name + text（或直接给 html）`)
        return null
      }
      return base

    case 'chain':
      if (base.html) return base
      base.nodes = arr(b.nodes).map((n) => str(n).trim()).filter(Boolean)
      // 也接受 "A → B → C" 这种一条字符串
      if (!base.nodes.length && base.text) {
        base.nodes = base.text.split(/→|—>|➜|->/).map((s) => s.trim()).filter(Boolean)
      }
      if (base.nodes.length < 2) {
        warnings.push(`${where}：chain 至少要 2 个节点（或直接给 html）`)
        return null
      }
      return base

    case 'tpl': {
      if (base.html) return base
      base.title = str(b.title) || '答题模板'
      base.paras = arr(b.paras).map((p) => (isObj(p) ? { label: str(p.label), text: str(p.text), html: str(p.html) } : { text: str(p) }))
      if (!base.paras.length && (base.text || base.html)) base.paras = [{ text: base.text, html: base.html }]
      if (!base.paras.length) {
        warnings.push(`${where}：tpl 没有 paras（或直接给 html）`)
        return null
      }
      return base
    }

    case 'quiz': {
      if (base.html) return base
      base.title = str(b.title)
      base.head = str(b.head)
      base.items = arr(b.items).map((q) => {
        if (!isObj(q)) return { text: str(q) }
        return {
          no: str(q.no),
          text: str(q.text ?? q.q ?? ''),
          html: str(q.html),
          options: arr(q.options).map((o) => str(o)),
          answer: str(q.answer),
          exp: str(q.exp ?? q.explain ?? ''),
        }
      })
      if (!base.items.length && (base.text || base.html)) base.items = [{ text: base.text, html: base.html }]
      if (!base.items.length) {
        warnings.push(`${where}：quiz 没有 items（或直接给 html）`)
        return null
      }
      return base
    }

    case 'list':
      base.ordered = b.ordered !== false
      base.items = arr(b.items).map((it) => (isObj(it) ? str(it.text) : str(it))).filter(Boolean)
      if (!base.items.length) {
        warnings.push(`${where}：list 没有 items`)
        return null
      }
      return base

    case 'table':
      base.head = arr(b.head).map((h) => str(h))
      base.rows = arr(b.rows).map((r) => arr(r).map((c) => str(c)))
      if (!base.rows.length) {
        warnings.push(`${where}：table 没有 rows`)
        return null
      }
      return base

    case 'image':
      base.src = str(b.src)
      base.ratio = Number(b.ratio) > 0 ? Number(b.ratio) : 1.6
      base.caption = str(b.caption)
      base.full = b.full === true || b.width === 'full'
      // 内联图片：服务端会落盘并改写 src（MCP upload_image 用）
      if (b.dataUrl) base.dataUrl = str(b.dataUrl)
      if (b.data) base.data = str(b.data)
      if (!base.src && !base.dataUrl && !base.data) warnings.push(`${where}：image 没有 src，会渲染成占位框`)
      return base

    case 'name-row':
      return base

    default:
      return base
  }
}

/**
 * 归一化任意输入（对象 / JSON 字符串）→ { layout, warnings }
 * 绝不抛错：能救的救，救不了记 warning 跳过。
 */
export function normalizeLayout(input) {
  const warnings = []
  let src = input
  if (typeof input === 'string') {
    try {
      src = JSON.parse(input)
    } catch (err) {
      return { layout: null, warnings: [`不是合法 JSON：${err.message}`] }
    }
  }
  if (!isObj(src)) return { layout: null, warnings: ['顶层必须是对象'] }

  // 允许 {layout:{...}} 包一层（MCP 参数常见）
  if (isObj(src.layout)) src = src.layout

  const orientation = ORIENTATIONS.includes(src.orientation) ? src.orientation : 'landscape'
  const meta = normMeta(src.meta)
  const rawBlocks = arr(src.blocks)
  if (!rawBlocks.length) warnings.push('blocks 为空，只会生成一页空白报纸')

  const blocks = []
  rawBlocks.forEach((b, i) => {
    if (!isObj(b)) {
      warnings.push(`blocks[${i}]：不是对象，已跳过`)
      return
    }
    if (!hasContent(b) && b.type !== 'section' && b.type !== 'name-row' && b.type !== 'image') {
      warnings.push(`blocks[${i}]：${b.type ?? '无 type'} 没有内容，已跳过`)
      return
    }
    const n = normBlock(b, warnings, i)
    if (n) blocks.push(n)
  })

  return { layout: { version: 1, orientation, meta, blocks }, warnings }
}

/**
 * 校验（不生成版面）：给 MCP / 命令行用，返回可读的问题清单。
 */
export function validateLayout(input) {
  const { layout, warnings } = normalizeLayout(input)
  const errors = []
  if (!layout) return { ok: false, errors: warnings, warnings: [], stats: null }
  if (!layout.blocks.length) errors.push('没有任何有效内容块')

  const counts = {}
  for (const b of layout.blocks) counts[b.type] = (counts[b.type] || 0) + 1

  // 提示：正常一期周刊的结构特征（不是错误，只提醒模型别漏）
  const tips = []
  if (!counts.section) tips.push('没有 section：整版会没有章节标题')
  if ((counts.para ?? 0) + (counts.note ?? 0) === 0) tips.push('正文很少，确认是不是漏了 para / note')

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    tips,
    stats: {
      blocks: layout.blocks.length,
      counts,
      chars: layout.blocks.reduce((n, b) => n + plainChars(b), 0),
    },
  }
}

/** 粗略统计块里的汉字数（给校验报告用，不影响排版） */
function plainChars(b) {
  const text = [b.text, b.html, b.title, b.name, b.label]
    .filter(Boolean)
    .join('')
    .replace(/<[^>]+>/g, '')
  return (text.match(/[\u4e00-\u9fa5]/g) || []).length + arr(b.items).join('').length + arr(b.paras).map((p) => (isObj(p) ? p.text : p)).join('').length
}
