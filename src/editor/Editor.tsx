import { useEffect, useState } from 'react'
import { useEditor } from './store'
import { rememberSelection } from './format'
import './tooltip.css'
import { Toolbar } from './Toolbar'
import { FormatBar } from './FormatBar'
import { Palette } from './Palette'
import { Canvas } from './Canvas'
import { Inspector } from './Inspector'
import '../styles/newspaper.css'
import './editor.css'
import './widgets.css'

function isTyping() {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

export function EditorApp() {
  const api = useEditor()

  // 暴露给自动化测试 / 调试（浏览器控制台可直接查看编辑器状态）
  useEffect(() => {
    ;(window as unknown as { __paibanApi?: unknown }).__paibanApi = api
    return () => {
      delete (window as unknown as { __paibanApi?: unknown }).__paibanApi
    }
  }, [api])

  // 记忆行内选区：点工具栏/下拉后仍能对选中文字应用格式
  useEffect(() => {
    const onSel = () => rememberSelection()
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [])

  // 全局悬浮提示（data-tip）：悬浮 0.25s 后弹出 WPS 风格功能介绍
  useEffect(() => {
    let tip: HTMLDivElement | null = null
    let timer: number | undefined
    const hide = () => {
      window.clearTimeout(timer)
      tip?.classList.remove('is-show')
    }
    const show = (target: HTMLElement) => {
      const text = target.getAttribute('data-tip')
      if (!text) return
      if (!tip) {
        tip = document.createElement('div')
        tip.className = 'ed-tip'
        document.body.appendChild(tip)
      }
      tip.innerHTML = text
      tip.classList.add('is-show')
      const r = target.getBoundingClientRect()
      const tr = tip.getBoundingClientRect()
      const right = target.getAttribute('data-tip-pos') === 'right'
      let x: number
      let y: number
      if (right) {
        x = r.right + 10
        y = r.top + r.height / 2 - tr.height / 2
        if (x + tr.width > window.innerWidth - 8) x = r.left - tr.width - 10 // 右侧放不下改左侧
      } else {
        x = r.left + r.width / 2 - tr.width / 2
        y = r.bottom + 8
        if (y + tr.height > window.innerHeight - 8) y = r.top - tr.height - 8 // 下方放不下改上方
      }
      x = Math.max(8, Math.min(x, window.innerWidth - tr.width - 8))
      y = Math.max(8, Math.min(y, window.innerHeight - tr.height - 8))
      tip.style.left = `${x}px`
      tip.style.top = `${y}px`
    }
    const onOver = (e: MouseEvent) => {
      const t = (e.target as HTMLElement | null)?.closest('[data-tip]') as HTMLElement | null
      window.clearTimeout(timer)
      if (!t) {
        tip?.classList.remove('is-show')
        return
      }
      timer = window.setTimeout(() => show(t), 250)
    }
    const onScroll = () => hide()
    document.addEventListener('mouseover', onOver)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('mouseover', onOver)
      window.removeEventListener('scroll', onScroll, true)
      tip?.remove()
      tip = null
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isTyping()
      const mod = e.metaKey || e.ctrlKey

      if (e.key === 'Escape') {
        if (api.editingId) {
          ;(document.activeElement as HTMLElement | null)?.blur()
        } else {
          api.setSelection(null)
        }
        return
      }
      if (typing) return

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) api.redo()
        else api.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        api.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (api.selection) api.duplicateEl(api.selection)
        return
      }
      if (!api.selection) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (api.subSelection) return
        api.removeEl(api.selection)
        return
      }
      // 方向键 1px 微调，Shift+方向键 10px；不做自动补齐，避免被吸回原位
      const step = e.shiftKey ? 10 : 1
      const map: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const delta = map[e.key]
      if (delta) {
        e.preventDefault()
        if (api.subSelection) {
          api.nudgeSub(api.subSelection.elId, api.subSelection.index, delta[0], delta[1])
        } else {
          api.nudge(api.selection, delta[0], delta[1])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [api])

  const [leftOpen, setLeftOpen] = useState(true) // 侧栏默认展开
  const [rightOpen, setRightOpen] = useState(true)

  const { w, h } = api.doc
  return (
    <div className="ed-app">
      <style>{`@page { size: ${w}px ${h}px; margin: 0; }
@media print {
  html, body, #root { width: ${w}px !important; }
  .ed-app, .ed-body, .ed-canvas, .ed-canvas-scroll { width: ${w}px !important; }
  .ed-page-wrap { width: ${w}px !important; height: ${h}px !important; }
  .ed-page { width: ${w}px !important; height: ${h}px !important; }
}`}</style>
      <Toolbar api={api} />
      <FormatBar api={api} />
      <div className="ed-body">
        <div className={`ed-side ed-side-left${leftOpen ? '' : ' is-collapsed'}`}>
          <button
            className="ed-side-toggle"
            aria-label="收起/展开组件库"
            data-tip={leftOpen ? '<b>收起组件库</b>点击折叠左侧栏，扩大画布' : '<b>展开组件库</b>点击恢复组件库'}
            onClick={() => setLeftOpen((v) => !v)}
          >
            {leftOpen ? '‹' : '›'}
          </button>
          <Palette api={api} />
        </div>
        <Canvas api={api} />
        <div className={`ed-side ed-side-right${rightOpen ? '' : ' is-collapsed'}`}>
          <button
            className="ed-side-toggle"
            aria-label="收起/展开属性面板"
            data-tip={rightOpen ? '<b>收起属性面板</b>点击折叠右侧栏，扩大画布' : '<b>展开属性面板</b>点击恢复属性面板'}
            onClick={() => setRightOpen((v) => !v)}
          >
            {rightOpen ? '›' : '‹'}
          </button>
          <Inspector api={api} />
        </div>
      </div>
    </div>
  )
}
