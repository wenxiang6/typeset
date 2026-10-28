/**
 * 轻量 HTML 白名单净化。
 *
 * 组件渲染走 dangerouslySetInnerHTML，凡是「从外部进来的版面」
 * （导入 JSON、导入模板、别人分享的 .paiban.json）都必须过这道闸。
 * 自己导出的文件同样过一遍——净化是幂等的，不影响现有内容。
 *
 * 保留排版需要的标签与 class/style；剥掉：
 * - <script> <iframe> <object> 等一切可执行/容器标签
 * - on* 事件属性
 * - javascript: / vbscript: 的 src、href
 * - style 里的 expression() / behavior
 */

const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'br', 'hr',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'img', 'a', 'sup', 'sub', 'small', 'code', 'pre', 'blockquote', 'mark',
  'section', 'article', 'header', 'footer', 'figure', 'figcaption', 'center',
  // 组件可以带自己的样式（HTML 编辑器里 CSS 面板写回来的一整块）
  'style',
])

/** 这些标签直接整棵删除（不可展开成文本） */
const DROP_TAGS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'link', 'meta', 'base', 'svg', 'math', 'form', 'input', 'button', 'textarea',
  'select', 'option', 'video', 'audio', 'source', 'track', 'canvas', 'template',
])

const ALLOWED_ATTRS = new Set(['class', 'style', 'colspan', 'rowspan', 'title', 'alt', 'width', 'height', 'align'])

/** src / href 只放行这些前缀（相对路径也算安全） */
const SAFE_URL = /^(https?:|data:image\/|data:font\/|blob:|\/|\.\/|\.\.\/|#)/i

function sanitizeStyleValue(v: string): string {
  return v.replace(/expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding/gi, '')
}

export function sanitizeHtml(html: string): string {
  if (!html || !html.includes('<')) return html ?? ''
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  } catch {
    return html.replace(/<script[\s\S]*?<\/script>/gi, '')
  }
  const root = doc.body
  if (!root) return html

  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase()
      if (DROP_TAGS.has(tag)) {
        child.remove()
        continue
      }
      if (!ALLOWED_TAGS.has(tag)) {
        // 未知容器不认识就不留壳，只把内容上提，再整体重扫一遍（幂等）
        const frag = doc.createDocumentFragment()
        while (child.firstChild) frag.appendChild(child.firstChild)
        child.replaceWith(frag)
        walk(parent)
        return
      }
      if (tag === 'style') {
        // 样式允许保留，但把「能往外发请求 / 能执行」的写法清掉
        const clean = (child.textContent ?? '')
          .replace(/@import[^;]*;?/gi, '')
          .replace(/expression\s*\([^)]*\)/gi, '')
          .replace(/javascript\s*:/gi, '')
          .replace(/vbscript\s*:/gi, '')
          .replace(/behavior\s*:/gi, '')
          .replace(/-moz-binding/gi, '')
        child.textContent = clean
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on')) {
          child.removeAttribute(attr.name)
          continue
        }
        if (name === 'src' || name === 'href') {
          if (!SAFE_URL.test(attr.value.trim())) {
            child.removeAttribute(attr.name)
          } else if (name === 'href') {
            child.setAttribute('rel', 'noopener noreferrer')
            child.setAttribute('target', '_blank')
          }
          continue
        }
        if (name === 'style') {
          child.setAttribute('style', sanitizeStyleValue(attr.value))
          continue
        }
        if (!ALLOWED_ATTRS.has(name)) child.removeAttribute(attr.name)
      }
      walk(child)
    }
  }
  walk(root)

  return root.innerHTML
}

/** 对整份 Doc 的所有元素内容做净化（就地返回新对象） */
export function sanitizeDocHtmls<T extends { pages?: Array<{ els?: Array<{ html?: string }> }> }>(doc: T): T {
  if (!doc?.pages) return doc
  return {
    ...doc,
    pages: doc.pages.map((p) => ({
      ...p,
      els: (p.els ?? []).map((el) => (el.html ? { ...el, html: sanitizeHtml(el.html) } : el)),
    })),
  }
}
