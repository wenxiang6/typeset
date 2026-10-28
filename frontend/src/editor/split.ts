/**
 * 大块拆小块 / 小块合并。
 *
 * 场景：一个「综合大题」框里有 5 个小问，或者一个答题模板框长得超过一栏，
 * 想让其中一半挪到下一栏——以前只能整块挪。这里把组件的**根元素的子节点**
 * 按段落边界切开，各自变成独立组件。
 *
 * 只切在子节点边界上，所以不会把一个句子切成两半。
 */

export type SplitMode = 'nodes' | 'chars' | 'at' | 'count'

export type SplitOptions = {
  /** 每几段一组（nodes 模式），默认 1 段一组 */
  perBlock?: number
  /** 累计多少字切一刀（chars 模式），默认 420 */
  chunkChars?: number
  /** 从第几段前切开（at 模式） */
  at?: number
  /** 想拆成几块（count 模式），默认 2；会按字数尽量均分 */
  parts?: number
}

const MEANINGFUL = (n: Node) => !(n.nodeType === 3 && !(n.textContent ?? '').trim())

/** 把 html 解析出根元素和它的有效子节点 */
function parse(html: string): { root: Element; nodes: Node[] } | null {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.body.firstElementChild
  if (!root) return null
  const nodes = Array.from(root.childNodes).filter(MEANINGFUL)
  return { root, nodes }
}

/** 用根元素的标签和属性包一组子节点 */
function wrap(root: Element, group: Node[], doc: Document): string {
  const shell = root.cloneNode(false) as Element
  for (const n of group) shell.appendChild(doc.importNode(n, true))
  return shell.outerHTML
}

/**
 * 把 html 拆成多段。拆不了（只有一段、或根元素下只有一个文本节点）时返回 [html]。
 */
export function splitHtmlParts(html: string, mode: SplitMode, opts: SplitOptions = {}): string[] {
  const src = String(html ?? '')
  if (!src.trim()) return [src]
  const parsed = parse(src)
  if (!parsed) return [src]
  const { root, nodes } = parsed
  if (nodes.length < 2) return [src]
  const doc = root.ownerDocument

  const groups: Node[][] = []

  if (mode === 'at') {
    const at = Math.min(Math.max(1, opts.at ?? 1), nodes.length - 1)
    groups.push(nodes.slice(0, at), nodes.slice(at))
  } else if (mode === 'chars') {
    const limit = Math.max(60, opts.chunkChars ?? 420)
    let cur: Node[] = []
    let len = 0
    for (const n of nodes) {
      const l = (n.textContent ?? '').length
      // 至少留一段，避免第一段就超限时切出空块
      if (cur.length && len + l > limit) {
        groups.push(cur)
        cur = []
        len = 0
      }
      cur.push(n)
      len += l
    }
    if (cur.length) groups.push(cur)
  } else if (mode === 'count') {
    /* 均分成 N 块：按累计字数找最接近 1/N、2/N… 的位置下刀。
     * 每刀都保证「剩下的节点还够切出剩下的组」，不会出现空格子。 */
    const want = Math.min(Math.max(2, Math.round(opts.parts ?? 2)), nodes.length)
    const total = nodes.reduce((s, n) => s + (n.textContent ?? '').length, 0)
    const target = total / want
    let cur: Node[] = []
    let acc = 0
    let made = 0
    nodes.forEach((n, i) => {
      cur.push(n)
      acc += (n.textContent ?? '').length
      const groupsLeft = want - made - 1
      const nodesLeft = nodes.length - i - 1
      if (groupsLeft > 0 && nodesLeft >= groupsLeft && acc >= target * (made + 1)) {
        groups.push(cur)
        cur = []
        made++
      }
    })
    if (cur.length) groups.push(cur)
  } else {
    const per = Math.max(1, opts.perBlock ?? 1)
    for (let i = 0; i < nodes.length; i += per) groups.push(nodes.slice(i, i + per))
  }

  if (groups.length < 2) return [src]
  return groups.map((g) => wrap(root, g, doc))
}

/**
 * 合并两个同结构的 html：把 b 的子节点追加到 a 的根元素里。
 * 标签不一致（比如 p 和 div）就返回 null，交给调用方拒绝。
 */
export function mergeHtml(a: string, b: string): string | null {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return null
  if (pa.root.tagName !== pb.root.tagName) return null
  const shell = pa.root.cloneNode(true) as Element
  for (const n of pb.nodes) shell.appendChild(pa.root.ownerDocument.importNode(n, true))
  return shell.outerHTML
}

/** 子节点数量（用来判断「能不能拆」，也用于面板上显示） */
export function countParts(html: string): number {
  const p = parse(html)
  return p ? p.nodes.length : 0
}
