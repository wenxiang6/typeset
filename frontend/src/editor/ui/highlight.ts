/**
 * 代码高亮的「最小可用」实现：不引第三方库，只为看清结构。
 *
 * 三条原则：
 *   1. 每个标签单独占一行、四空格缩进（块级元素换行，行内的 strong/em 不拆句子）；
 *   2. 同一标签名永远同一颜色，不同标签不同色（按名字哈希，避免新增标签没色）；
 *   3. 行内文本不染色，保证一眼能看出「结构」和「内容」的分界。
 */

export type TokenKind = 'tag' | 'attr' | 'value' | 'text' | 'punct' | 'comment' | 'prop' | 'selector'
export type Token = { text: string; kind: TokenKind; hue?: number }

/* ------------------------------------------------------------------ *
 * 标签配色
 * ------------------------------------------------------------------ */

/** 常用标签给固定色相，其余按名字哈希——保证「同名同色、异名异色」 */
const TAG_HUE: Record<string, number> = {
  div: 212,
  p: 152,
  span: 280,
  section: 24,
  article: 24,
  header: 24,
  footer: 24,
  h1: 24,
  h2: 24,
  h3: 24,
  h4: 24,
  h5: 24,
  h6: 24,
  ul: 122,
  ol: 122,
  li: 122,
  table: 190,
  thead: 190,
  tbody: 190,
  tr: 190,
  td: 190,
  th: 190,
  strong: 348,
  b: 348,
  em: 300,
  i: 300,
  a: 205,
  img: 320,
  figure: 12,
  figcaption: 12,
  style: 45,
}

export function tagHue(name: string): number {
  const key = name.toLowerCase()
  const fixed = TAG_HUE[key]
  if (fixed !== undefined) return fixed
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return h
}

/** 深色文字（浅底可读），同色相不同标签靠明度区分 */
export function tagColor(name: string): string {
  return `hsl(${tagHue(name)} 58% 36%)`
}

/* ------------------------------------------------------------------ *
 * HTML 词法切分
 * ------------------------------------------------------------------ */

/** 把 HTML 切成 token：标签名、属性名、属性值、正文、注释 */
export function tokenizeHtml(code: string): Token[] {
  const out: Token[] = []
  const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push({ text: code.slice(last, m.index), kind: 'text' })
    if (m[0].startsWith('<!--')) out.push({ text: m[0], kind: 'comment' })
    else pushTagTokens(out, m[0])
    last = m.index + m[0].length
  }
  if (last < code.length) out.push({ text: code.slice(last), kind: 'text' })
  return out
}

function pushTagTokens(out: Token[], raw: string) {
  const head = /^<(\/?)([a-zA-Z][\w:-]*)/.exec(raw)
  if (!head) {
    out.push({ text: raw, kind: 'punct' })
    return
  }
  out.push({ text: '<', kind: 'punct' })
  if (head[1]) out.push({ text: '/', kind: 'punct' })
  out.push({ text: head[2], kind: 'tag', hue: tagHue(head[2]) })

  let rest = raw.slice(head[0].length)
  const tail = /\/?>$/.exec(rest)?.[0] ?? ''
  if (tail) rest = rest.slice(0, rest.length - tail.length)

  const attrRe = /(\s+)([^\s=/>]+)(\s*=\s*)?("[^"]*"|'[^']*'|[^\s>]+)?/g
  let last = 0
  let am: RegExpExecArray | null
  while ((am = attrRe.exec(rest)) !== null) {
    if (am.index > last) out.push({ text: rest.slice(last, am.index), kind: 'text' })
    out.push({ text: am[1], kind: 'text' })
    out.push({ text: am[2], kind: 'attr' })
    if (am[3]) out.push({ text: am[3], kind: 'punct' })
    if (am[4]) out.push({ text: am[4], kind: 'value' })
    last = am.index + am[0].length
  }
  if (last < rest.length) out.push({ text: rest.slice(last), kind: 'text' })
  if (tail) out.push({ text: tail, kind: 'punct' })
}

/* ------------------------------------------------------------------ *
 * CSS 词法切分
 * ------------------------------------------------------------------ */

export function tokenizeCss(code: string): Token[] {
  const out: Token[] = []
  const re = /\/\*[\s\S]*?\*\/|[{}]|[^{}]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const chunk = m[0]
    if (chunk.startsWith('/*')) {
      out.push({ text: chunk, kind: 'comment' })
      continue
    }
    if (chunk === '{' || chunk === '}') {
      out.push({ text: chunk, kind: 'punct' })
      continue
    }
    // 在选择器块里：整段是选择器；在声明块里：name: value;
    pushDeclTokens(out, chunk)
  }
  return out
}

function pushDeclTokens(out: Token[], chunk: string) {
  const declRe = /([\w-]+)(\s*:\s*)([^;]*)(;?)/g
  let last = 0
  let dm: RegExpExecArray | null
  let matched = false
  while ((dm = declRe.exec(chunk)) !== null) {
    matched = true
    if (dm.index > last) out.push({ text: chunk.slice(last, dm.index), kind: 'selector' })
    out.push({ text: dm[1], kind: 'prop' })
    out.push({ text: dm[2], kind: 'punct' })
    if (dm[3]) out.push({ text: dm[3], kind: 'value' })
    if (dm[4]) out.push({ text: dm[4], kind: 'punct' })
    last = dm.index + dm[0].length
  }
  if (!matched) {
    out.push({ text: chunk, kind: 'selector' })
    return
  }
  if (last < chunk.length) out.push({ text: chunk.slice(last), kind: 'selector' })
}

/* ------------------------------------------------------------------ *
 * HTML 格式化
 * ------------------------------------------------------------------ */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

/** 行内标签：跟着上一行文字走，不单独换行，否则一句话会被拆成七八行 */
const INLINE_TAGS = new Set([
  'a', 'b', 'strong', 'em', 'i', 'u', 's', 'span', 'sup', 'sub', 'small', 'code',
  'mark', 'br', 'img', 'abbr', 'time', 'cite', 'q', 'del', 'ins', 'kbd', 'var',
])

/** 内部空白要原样保留的标签 */
const RAW_TAGS = new Set(['pre', 'code', 'textarea'])

const INDENT = '    '

function pad(depth: number) {
  return INDENT.repeat(Math.max(0, depth))
}

/**
 * 只压缩 ASCII 空白。中文排版常用全角空格（\u3000）做首行缩进，
 * 用 \s+ 会连它一起吃掉，排出来的稿子首行就不缩进了。
 */
function collapse(s: string) {
  return s.replace(/[ \t\r\n\f]+/g, ' ')
}

function trimAscii(s: string) {
  return s.replace(/^[ \t\r\n\f]+|[ \t\r\n\f]+$/g, '')
}

/** 起止标签之间的内容是否全是行内/文本（决定能否塞进同一行） */
/**
 * 能不能整段塞进一行？
 *
 * 规则：子元素全是行内、而且最多只有一个 —— 才内联。
 * `<div class="trap"><span>x</span><span>正文</span></div>` 有两个 span，
 * 虽然都是行内，但它们是「并列的两块内容」，必须各占一行才看得出结构；
 * 反过来 `<p><span class="ans">答案：</span>后面一长串正文</p>` 只有一个 span，
 * 拆开反而把一句话拦腰截断。
 *
 * @returns 行内子元素个数；含块级元素时返回 -1（必须拆行）
 */
function inlineChildCount(el: Element): number {
  let n = 0
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const tag = (child as Element).tagName.toLowerCase()
    if (!INLINE_TAGS.has(tag)) return -1
    if (inlineChildCount(child as Element) < 0) return -1
    n += 1
  }
  return n
}

function attrs(el: Element): string {
  const list: string[] = []
  for (const a of Array.from(el.attributes)) {
    const v = a.value.replace(/"/g, '&quot;')
    list.push(`${a.name}="${v}"`)
  }
  return list.length ? ' ' + list.join(' ') : ''
}

/** 元素序列化成「一行」（行内元素专用，递归） */
function inlineHtml(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return collapse(node.textContent ?? '')
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  const tag = el.tagName.toLowerCase()
  if (tag === 'br') return '<br>'
  const inner = trimAscii(Array.from(el.childNodes).map(inlineHtml).join(''))
  return `<${tag}${attrs(el)}>${inner}</${tag}>`
}

/**
 * 把 HTML 排成「一个标签一行、四空格缩进」的样子。
 *
 * 只处理结构，不改内容：属性顺序、引号内的值、正文文字都原样保留。
 * 行内元素不拆行——否则每个 strong / span 都独立成行，反而更难读。
 */
export function formatHtml(html: string): string {
  const src = (html ?? '').trim()
  if (!src) return ''
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(`<body>${src}</body>`, 'text/html')
  } catch {
    return src
  }
  const lines: string[] = []

  const walk = (node: Node, depth: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = trimAscii(collapse(node.textContent ?? ''))
      if (text) lines.push(pad(depth) + text)
      return
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      lines.push(pad(depth) + `<!--${node.textContent ?? ''}-->`)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return

    const el = node as Element
    const tag = el.tagName.toLowerCase()
    const open = `<${tag}${attrs(el)}>`

    if (VOID_TAGS.has(tag)) {
      lines.push(pad(depth) + open)
      return
    }
    if (tag === 'br') {
      lines.push(pad(depth) + '<br>')
      return
    }
    // pre / code：内部空格有意义，整体原样保留
    if (RAW_TAGS.has(tag)) {
      const raw = el.textContent ?? ''
      if (!raw.trim()) {
        lines.push(pad(depth) + `${open}</${tag}>`)
      } else {
        lines.push(pad(depth) + open)
        for (const line of raw.replace(/\n+$/, '').split('\n')) lines.push(line)
        lines.push(pad(depth) + `</${tag}>`)
      }
      return
    }
    // 行内元素：整段塞一行，不拆
    if (INLINE_TAGS.has(tag)) {
      lines.push(pad(depth) + inlineHtml(el))
      return
    }
    // 最多一个行内子元素：标签和文字同一行，更像人写的；
    // 多个并列的行内元素（div 里两三段 span）则交给下面逐行展开
    const inlineN = inlineChildCount(el)
    if (inlineN >= 0 && inlineN <= 1) {
      const inner = trimAscii(Array.from(el.childNodes).map(inlineHtml).join(''))
      if (!inner) lines.push(pad(depth) + `${open}</${tag}>`)
      else lines.push(pad(depth) + `${open}${inner}</${tag}>`)
      return
    }

    lines.push(pad(depth) + open)
    for (const child of Array.from(el.childNodes)) walk(child, depth + 1)
    lines.push(pad(depth) + `</${tag}>`)
  }

  for (const child of Array.from(doc.body.childNodes)) walk(child, 0)
  return lines.join('\n')
}

/* ------------------------------------------------------------------ *
 * <style> 抽取 / 合并
 * ------------------------------------------------------------------ */

export type SplitResult = { css: string; html: string }

/** 把 html 里的 <style> 全抽出来（合并成一份 CSS），剩下的就是纯结构 */
export function splitStyle(html: string): SplitResult {
  const cssParts: string[] = []
  const rest = (html ?? '').replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css: string) => {
    const t = String(css).trim()
    if (t) cssParts.push(t)
    return ''
  })
  return { css: cssParts.join('\n\n'), html: rest.trim() }
}

/** 保存时把 CSS 重新包成 <style> 放回最前面 */
export function joinStyle(css: string, html: string): string {
  const c = (css ?? '').trim()
  const h = (html ?? '').trim()
  if (!c) return h
  return `<style>\n${c}\n</style>${h ? '\n' + h : ''}`
}
