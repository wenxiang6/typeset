import { useRef } from 'react'
import type { EditorApi } from './store'
import { exportJSON, FONT_FAMILIES, FONT_SIZES, LETTER_SPACINGS, LINE_HEIGHTS, inlineBold, inlineClear, inlineColor, inlineFontFamily, inlineFontSize, inlineHighlight, inlineItalic, inlineList, inlineStrike, inlineUnderline, activeEditable } from './format'
import {
  IconAlignCenter, IconAlignJustify, IconAlignLeft, IconAlignRight, IconDownload, IconEraser,
  IconHighlight, IconListOl, IconListUl, IconPrint, IconTextColor,
} from './icons'

export function FormatBar({ api }: { api: EditorApi }) {
  const sel = api.selection ? api.findEl(api.selection) : null
  const style = sel?.style ?? {}
  const colorRef = useRef<HTMLInputElement>(null)
  const bgRef = useRef<HTMLInputElement>(null)

  // 点按钮不让输入框失焦，保住选区（WPS/Word 行为）
  const inEditor = () => !!activeEditable()
  const setEl = (patch: Record<string, unknown>) => {
    if (!sel) return
    api.updateStyle(sel.id, patch)
  }

  return (
    <div
      className="ed-formatbar"
      onMouseDown={(e) => {
        // 点按钮/色块时不抢走内容编辑焦点，保住行内选区
        const t = e.target as HTMLElement
        if (t.closest('button')) e.preventDefault()
      }}
    >
      <label className="ed-fb-item" data-tip="<b>字体</b>对选中元素/选中文字设置字体（默认黑体）">
        <span>字体</span>
        <select
          value={style.fontFamily ?? ''}
          onChange={(e) => {
            const v = e.target.value
            if (inEditor() && window.getSelection()?.isCollapsed === false) inlineFontFamily(v)
            setEl({ fontFamily: v })
          }}
        >
          <option value="">默认</option>
          {FONT_FAMILIES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>

      <label className="ed-fb-item" data-tip="<b>字号</b>五号=14px、小四=16px、四号≈18.7px">
        <span>字号</span>
        <select
          value={style.fontSize ? parseFloat(style.fontSize) : ''}
          onChange={(e) => {
            const px = parseFloat(e.target.value)
            if (!px) return
            if (inEditor() && window.getSelection()?.isCollapsed === false) inlineFontSize(px)
            setEl({ fontSize: `${px}px` })
          }}
        >
          <option value="">默认</option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <div className="ed-fb-group">
        <button data-tip="<b>加粗</b>选中文字或整个元素加粗 <span class='kbd'>Ctrl+B</span>" onClick={() => (inEditor() ? inlineBold() : setEl({ fontWeight: 'bold' }))}>
          <b>B</b>
        </button>
        <button data-tip="<b>斜体</b>选中文字倾斜 <span class='kbd'>Ctrl+I</span>" onClick={() => (inEditor() ? inlineItalic() : setEl({ italic: !style.italic }))}>
          <i>I</i>
        </button>
        <button data-tip="<b>下划线</b>为选中文字加下划线 <span class='kbd'>Ctrl+U</span>" onClick={() => (inEditor() ? inlineUnderline() : setEl({ underline: !style.underline }))}>
          <u>U</u>
        </button>
        <button data-tip="<b>删除线</b>为选中文字加删除线" onClick={() => (inEditor() ? inlineStrike() : setEl({ strike: !style.strike }))}>
          <s>S</s>
        </button>
      </div>

      <div className="ed-fb-group">
        <button data-tip="<b>字色</b>设置文字颜色（点开色板）" onClick={() => colorRef.current?.click()}>
          <IconTextColor />
          <span className="ed-color-dot" style={{ background: style.color ?? '#000' }} />
        </button>
        <input
          ref={colorRef}
          type="color"
          className="ed-hidden-input"
          value={style.color ?? '#000000'}
          onChange={(e) => {
            if (inEditor() && window.getSelection()?.isCollapsed === false) inlineColor(e.target.value)
            setEl({ color: e.target.value })
          }}
        />
        <button data-tip="<b>高亮底色</b>为选中文字/元素加背景色（如黄色荧光）" onClick={() => bgRef.current?.click()}>
          <IconHighlight />
          <span className="ed-color-dot" style={{ background: style.background ?? '#ffff00' }} />
        </button>
        <input
          ref={bgRef}
          type="color"
          className="ed-hidden-input"
          value={style.background ?? '#ffff00'}
          onChange={(e) => {
            if (inEditor() && window.getSelection()?.isCollapsed === false) inlineHighlight(e.target.value)
            setEl({ background: e.target.value })
          }}
        />
      </div>

      <div className="ed-fb-group">
        <button className={style.align === 'left' || !style.align ? 'is-on' : ''} data-tip="<b>左对齐</b>文字靠左（默认）" onClick={() => setEl({ align: 'left' })}>
          <IconAlignLeft />
        </button>
        <button className={style.align === 'center' ? 'is-on' : ''} data-tip="<b>居中</b>文字水平居中" onClick={() => setEl({ align: 'center' })}>
          <IconAlignCenter />
        </button>
        <button className={style.align === 'right' ? 'is-on' : ''} data-tip="<b>右对齐</b>文字靠右" onClick={() => setEl({ align: 'right' })}>
          <IconAlignRight />
        </button>
        <button className={style.align === 'justify' ? 'is-on' : ''} data-tip="<b>两端对齐</b>段落两端对齐（末行除外）" onClick={() => setEl({ align: 'justify' })}>
          <IconAlignJustify />
        </button>
      </div>

      <label className="ed-fb-item" data-tip="<b>行距</b>行与行之间的距离倍数（1.0 紧凑，1.8 舒展）">
        <span>行距</span>
        <select value={style.lineHeight ?? ''} onChange={(e) => setEl({ lineHeight: e.target.value })}>
          <option value="">默认</option>
          {LINE_HEIGHTS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </label>

      <label className="ed-fb-item" data-tip="<b>字距</b>字符之间的间距（标题常用宽字距）">
        <span>字距</span>
        <select value={style.letterSpacing ?? ''} onChange={(e) => setEl({ letterSpacing: e.target.value })}>
          <option value="">默认</option>
          {LETTER_SPACINGS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <div className="ed-fb-group">
        <button data-tip="<b>有序列表</b>把选中段落变成 1. 2. 3. 条目" onClick={() => inlineList(true)}>
          <IconListOl />
        </button>
        <button data-tip="<b>无序列表</b>把选中段落变成 • 项目符号条目" onClick={() => inlineList(false)}>
          <IconListUl />
        </button>
        <button
          data-tip="<b>清除格式</b>去掉选中文字的行内样式，并重置元素为默认样式"
          onClick={() => {
            if (inEditor()) inlineClear()
            if (sel) api.updateEl(sel.id, { style: {} })
          }}
        >
          <IconEraser />
        </button>
      </div>

      <div className="ed-fb-group">
        <button data-tip="<b>导出 JSON</b>保存整份版面为文件" onClick={() => exportJSON(api.doc)}>
          <IconDownload />
        </button>
        <button data-tip="<b>打印设置</b>选择彩色/黑白预览后打印或导出 PDF" onClick={() => (document.querySelector('.ed-print-trigger') as HTMLButtonElement | null)?.click()}>
          <IconPrint />
        </button>
      </div>
    </div>
  )
}
