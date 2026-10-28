/**
 * HTML 编辑器：从窗口右侧整体滑出的独立弹窗（不是嵌在属性面板里）。
 *
 * 之前那版用 position: fixed 挂在属性面板内部，结果看不见——因为面板上有
 * backdrop-filter（玻璃拟态），它会创建「包含块」，fixed 就退化成相对面板定位，
 * 820px 宽的抽屉被塞进 300px 的面板里裁掉了。
 * 现在用 createPortal 挂到 document.body，彻底脱离面板的包含块。
 *
 * 代码区：
 *   - 打开即格式化：一个标签一行、四空格缩进，点「应用」才写回（不动就完全不动）；
 *   - 同名标签同色、异名异色，行内文字保持黑色，结构一眼能看清；
 *   - <style> 抽到上方面板单独编辑，保存时再拼回最前面。
 *
 * 实时性：
 *   - 左栏预览跟着输入即时更新（同一套报纸样式 + 同样的栏宽，所见即所得）
 *   - 画布上的组件也会在停止输入 500ms 后更新（防抖，且不记历史）
 *   - 点「应用」才结束事务、合并成一步撤销
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { sanitizeHtml } from '../sanitize'
import { CodeEditor } from './CodeEditor'
import { formatHtml, joinStyle, splitStyle } from './highlight'

export function HtmlDrawer({
  open,
  title,
  value,
  onPreview,
  onApply,
  onCancel,
}: {
  open: boolean
  title: string
  /** 打开时的原始 HTML */
  value: string
  /** 实时预览写回（不记历史），停止输入后调用 */
  onPreview: (html: string) => void
  /** 应用：结束事务 */
  onApply: (html: string) => void
  /** 取消：还原成 value 并结束事务 */
  onCancel: () => void
}) {
  /** 打开那一刻的格式化结果，作为「没改过」的基线 */
  const [base, setBase] = useState({ css: '', html: '' })
  const [css, setCss] = useState('')
  const [draft, setDraft] = useState('')
  const [touched, setTouched] = useState(false)
  /** 自动换行：默认开（一行几百字要拖横向滚动条没法看），偏好记在本地 */
  const [wrap, setWrap] = useState(() => {
    try {
      return localStorage.getItem('paiban-html-wrap-v1') !== '0'
    } catch {
      return true
    }
  })
  const toggleWrap = () => {
    setWrap((v) => {
      try {
        localStorage.setItem('paiban-html-wrap-v1', v ? '0' : '1')
      } catch {
        /* 忽略 */
      }
      return !v
    })
  }
  const cb = useRef({ onPreview, onApply, onCancel })
  cb.current = { onPreview, onApply, onCancel }

  useEffect(() => {
    if (!open) return
    const split = splitStyle(value ?? '')
    const pretty = formatHtml(split.html)
    setBase({ css: split.css, html: pretty })
    setCss(split.css)
    setDraft(pretty)
    setTouched(false)
  }, [open, value])

  const full = useMemo(() => joinStyle(css, draft), [css, draft])
  const preview = useMemo(() => sanitizeHtml(full), [full])

  /* 停止输入 500ms 后把内容写回画布（不记历史）。没改过就不打扰画布 */
  useEffect(() => {
    if (!open || !touched) return
    const t = window.setTimeout(() => cb.current.onPreview(preview), 500)
    return () => window.clearTimeout(t)
  }, [preview, open, touched])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        cb.current.onCancel()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        cb.current.onApply(touched ? sanitizeHtml(full) : value)
      }
    }
    // 捕获阶段拦，避免被画布的快捷键处理掉
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, touched, full, value])

  if (!open) return null

  const cancel = () => cb.current.onCancel()
  const apply = () => cb.current.onApply(touched ? sanitizeHtml(full) : value)
  const htmlLines = draft.split('\n').length
  const cssLines = css.trim() ? css.split('\n').length : 0

  return createPortal(
    <>
      <div className="ed-htmlsplit-mask" onPointerDown={cancel} />
      <aside className="ed-htmlsplit" role="dialog" aria-modal="true" aria-label="HTML 编辑">
        <header className="ed-htmlsplit-head">
          <strong>HTML 编辑</strong>
          <span className="ed-htmlsplit-sub">{title}</span>
          {touched ? <span className="ed-htmlsplit-dirty">未应用</span> : null}
          <span className="ed-htmlsplit-keys">Tab 缩进 · ⌘/Ctrl + Enter 应用 · Esc 取消</span>
          <button type="button" className="ed-htmlsplit-close" onClick={cancel} title="关闭并还原">
            ×
          </button>
        </header>

        <div className="ed-htmlsplit-body">
          <section className="ed-htmlsplit-pane">
            <div className="ed-htmlsplit-pane-tag">实时预览（栏宽 · 报纸样式）</div>
            <div className="ed-htmlsplit-preview">
              <div className="ed-htmlsplit-page" dangerouslySetInnerHTML={{ __html: preview }} />
            </div>
          </section>

          <section className="ed-htmlsplit-pane">
            <div className="ed-htmlsplit-pane-tag">
              源码
              <span className="ed-htmlsplit-count">
                {htmlLines} 行{base.css || css ? ` · CSS ${cssLines} 行` : ''}
              </span>
            </div>

            <div className="ed-source">
              {css.trim() ? (
                <div className="ed-source-block is-css">
                  <div className="ed-source-tag">
                    <span className="ed-source-dot" aria-hidden />
                    CSS（保存时自动放回 &lt;style&gt; 里）
                  </div>
                  <CodeEditor
                    value={css}
                    onChange={(v) => {
                      setCss(v)
                      setTouched(true)
                    }}
                    language="css"
                    ariaLabel="组件内联样式"
                    wrap={wrap}
                  />
                </div>
              ) : null}

              <div className="ed-source-block">
                {css.trim() ? (
                  <div className="ed-source-tag">
                    <span className="ed-source-dot" aria-hidden />
                    HTML
                  </div>
                ) : null}
                <CodeEditor
                  value={draft}
                  onChange={(v) => {
                    setDraft(v)
                    setTouched(true)
                  }}
                  language="html"
                  ariaLabel="组件 HTML"
                  wrap={wrap}
                />
              </div>
            </div>
          </section>
        </div>

        <footer className="ed-htmlsplit-foot">
          <span className="ed-htmlsplit-hint">
            停止输入后画布会自动刷新；<code>script</code> 与 <code>on*</code> 事件属性会被过滤。
          </span>
          <button
            type="button"
            className={wrap ? 'is-toggle-on' : undefined}
            onClick={toggleWrap}
            title={wrap ? '当前自动换行（点击改为横向滚动）' : '当前横向滚动（点击改为自动换行）'}
          >
            自动换行：{wrap ? '开' : '关'}
          </button>
          <button type="button" onClick={() => setDraft(formatHtml(draft))} title="重新缩进（不改内容）">
            格式化
          </button>
          <button
            type="button"
            onClick={() => {
              setCss(base.css)
              setDraft(base.html)
              setTouched(false)
            }}
            disabled={!touched}
          >
            还原文本
          </button>
          <button type="button" onClick={cancel}>
            取消
          </button>
          <button type="button" className="is-primary" onClick={apply}>
            应用
          </button>
        </footer>
      </aside>
    </>,
    document.body,
  )
}
