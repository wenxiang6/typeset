/**
 * 带高亮 / 行号 / 四空格缩进的代码编辑器。
 *
 * 实现方式：透明文字的 textarea 叠在彩色 <pre> 上（两层字体、行高、内边距完全一致）。
 * 不用 contenteditable，是因为它会在粘贴时带进一堆行内标签，反而更难编辑；
 * 引 CodeMirror 又要多 100KB+，这里的需求（看清结构、不改语法）用不着。
 */
import { useMemo, useRef } from 'react'
import { tokenizeCss, tokenizeHtml, type Token } from './highlight'

const INDENT = '    '
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

export function CodeEditor({
  value,
  onChange,
  language = 'html',
  readOnly,
  placeholder,
  ariaLabel,
  wrap = true,
}: {
  value: string
  onChange: (next: string) => void
  language?: 'html' | 'css'
  readOnly?: boolean
  placeholder?: string
  ariaLabel?: string
  /** 自动换行：默认开。关闭后长行横向滚动，同时恢复行号显示 */
  wrap?: boolean
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const tokens = useMemo<Token[]>(
    () => (language === 'css' ? tokenizeCss(value) : tokenizeHtml(value)),
    [value, language],
  )
  const lineCount = useMemo(() => value.split('\n').length, [value])

  /** 三层同步滚动：彩色层跟位移，行号跟纵向 */
  const syncScroll = () => {
    const input = inputRef.current
    const pre = preRef.current
    const gutter = gutterRef.current
    if (!input) return
    // 自动换行时不会有横向滚动，pre 只跟纵向
    const left = wrap ? 0 : input.scrollLeft
    if (pre) pre.style.transform = `translate(${-left}px, ${-input.scrollTop}px)`
    if (gutter) gutter.style.transform = `translateY(${-input.scrollTop}px)`
  }

  const commit = (next: string) => {
    onChange(next)
    // 受控组件：值由父级回写，下一帧再把光标放回去
    requestAnimationFrame(syncScroll)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    const v = el.value
    const s = el.selectionStart
    const end = el.selectionEnd

    if (e.key === 'Tab') {
      e.preventDefault()
      const lineStart = v.lastIndexOf('\n', s - 1) + 1
      const nl = v.indexOf('\n', end)
      const lineEnd = nl === -1 ? v.length : nl
      const multiline = v.slice(s, end).includes('\n')

      if (e.shiftKey) {
        // 取消缩进：选中几行就退几行（没选中就退当前行）
        const block = v.slice(lineStart, lineEnd)
        const next = block
          .split('\n')
          .map((line) => line.replace(/^ {1,4}/, ''))
          .join('\n')
        el.setRangeText(next, lineStart, lineEnd, 'end')
        commit(el.value)
        return
      }
      if (multiline) {
        const block = v.slice(lineStart, lineEnd)
        const next = block
          .split('\n')
          .map((line) => INDENT + line)
          .join('\n')
        el.setRangeText(next, lineStart, lineEnd, 'end')
        commit(el.value)
        return
      }
      // 单点：插入 4 个空格（不是制表符，跨编辑器复制不会错位）
      el.setRangeText(INDENT, s, end, 'end')
      commit(el.value)
      return
    }

    if (e.key === 'Enter') {
      const lineStart = v.lastIndexOf('\n', s - 1) + 1
      const line = v.slice(lineStart, s)
      const indent = /^[ \t]*/.exec(line)?.[0] ?? ''
      // 刚敲完一个开标签就换行 → 自动多缩一层
      const tailTag = /<([a-zA-Z][\w:-]*)(\s[^<>]*)?>$/.exec(v.slice(0, s).replace(/\s+$/, ''))
      const nested = tailTag && !VOID_TAGS.has(tailTag[1].toLowerCase()) && !tailTag[0].startsWith('</')
      e.preventDefault()
      el.setRangeText(`\n${indent}${nested ? INDENT : ''}`, s, end, 'end')
      commit(el.value)
      return
    }

    // 输入 < 后自动补 >
    if (e.key === '>' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // 交给浏览器默认行为，这里只负责滚动同步
    }
  }

  return (
    <div className={`ed-code${wrap ? ' is-wrap' : ''}`}>
      {/*
       * 自动换行时不显示行号：软换行会让「逻辑行」和「视觉行」对不上，
       * 硬贴着写反而误导（第 3 行在屏幕上可能已经排到第 9 屏行）。
       */}
      {!wrap ? (
        <div className="ed-code-gutter" aria-hidden>
          <div className="ed-code-gutter-inner" ref={gutterRef}>
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="ed-code-main">
        <pre className="ed-code-hl" ref={preRef} aria-hidden>
          {tokens.map((t, i) =>
            t.kind === 'text' ? (
              t.text
            ) : (
              <span key={i} className={`tk-${t.kind}`} style={t.hue !== undefined ? { color: `hsl(${t.hue} 58% 36%)` } : undefined}>
                {t.text}
              </span>
            ),
          )}
          {'\n'}
        </pre>
        <textarea
          ref={inputRef}
          className="ed-code-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap={wrap ? 'soft' : 'off'}
          placeholder={placeholder}
          aria-label={ariaLabel}
        />
      </div>
    </div>
  )
}
