import { useEffect, useRef, useState } from 'react'
import { useEditor } from './store'
import { rememberSelection } from './format'
import { openPrintPreview } from './print'
import { fileToCompactDataURL } from './imageTools'
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
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/**
 * 焦点在任何表单控件上（含下拉）。方向键要留给下拉改选项，
 * 但 Ctrl+Z / Ctrl+A 不在此列——改完字号直接撤销是常规操作，
 * 不该因为焦点还停在下拉框里就失效。
 */
function isFormFocus() {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return isTyping() || el.tagName === 'SELECT'
}

/** 桌面版（Electron）通过预加载脚本注入的桥；网页版没有 */
interface DesktopBridge {
  platform?: string
  onPrint?: (cb: () => void) => void
  onOpenJson?: (cb: () => void) => void
}

export function EditorApp() {
  const api = useEditor()
  const apiRef = useRef(api)
  apiRef.current = api

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

  // 桌面版：接系统菜单的「打印预览」「打开版面 JSON」
  useEffect(() => {
    const bridge = (window as unknown as { paibanDesktop?: DesktopBridge }).paibanDesktop
    if (!bridge) return
    bridge.onPrint?.(() => {
      const cur = apiRef.current
      document.body.classList.remove('ed-bw-preview')
      openPrintPreview({ w: cur.doc.w, h: cur.doc.h, orientation: cur.doc.orientation ?? 'landscape' })
    })
    bridge.onOpenJson?.(() => {
      document.querySelector<HTMLInputElement>('input[accept="application/json"]')?.click()
    })
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

  // api 是 useMemo 出来的新对象，每次渲染都变 —— 全局监听走已有的 apiRef（组件顶部声明），
  // keydown effect 只绑一次，别每渲染都 remove/add 一遍

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const current = apiRef.current
      const typing = isTyping()
      const mod = e.metaKey || e.ctrlKey

      if (e.key === 'Escape') {
        if (current.editingId) {
          ;(document.activeElement as HTMLElement | null)?.blur()
        } else {
          current.setSelection(null)
        }
        return
      }
      if (typing) return

      if (mod && e.key.toLowerCase() === 'a') {
        // 全选当前页（背景、区域块除外）
        e.preventDefault()
        const page = current.doc.pages[current.pageIdx]
        if (!page) return
        const ids = page.els.filter((x) => !x.background && x.kind !== 'region').map((x) => x.id)
        if (ids.length) current.setSelectionGroup(ids)
        return
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) current.redo()
        else current.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        current.redo()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (current.selection) current.duplicateEl(current.selection)
        return
      }
      if (mod && (e.key === 'c' || e.key === 'x' || e.key === 'v')) {
        // 组件级剪贴板；正在输入文字时走浏览器原生行为
        e.preventDefault()
        if (e.key === 'c') current.copySel()
        else if (e.key === 'x') current.cutSel()
        else current.pasteSel()
        return
      }
      if (!current.selection) return
      // 光标还停在下拉框/输入框里：方向键与删除键让给控件自己
      if (isFormFocus()) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        if (current.subSelection) return
        if (current.selectedIds.length > 1) current.removeSelected()
        else current.removeEl(current.selection)
        return
      }
      /* 方向键 = 与上下左右最近的相邻组件交换位置；
       * Alt / Option + 方向键 = 微调 1px，再按 Shift 变 10px。
       * 选中了复合组件的内部元素时，方向键仍然只微调那个内部元素。 */
      const swapDirs: Record<string, 'up' | 'down' | 'left' | 'right'> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      }
      const dir = swapDirs[e.key]
      if (!dir) return
      e.preventDefault()

      const step = e.shiftKey ? 10 : 1
      const nudgeMap: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const delta = nudgeMap[e.key]

      if (current.subSelection) {
        current.nudgeSub(current.subSelection.elId, current.subSelection.index, delta[0], delta[1])
      } else if (e.altKey) {
        // 不做自动补齐，避免被吸回原位
        current.nudge(current.selection, delta[0], delta[1])
      } else {
        current.swapNeighbor(current.selection, dir)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 粘贴截图 / 复制的图片文件：直接落到当前页（自动压缩后内嵌）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const current = apiRef.current
      if (isTyping()) return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue
        const f = item.getAsFile()
        if (!f) continue
        e.preventDefault()
        fileToCompactDataURL(f).then((src) => {
          const probe = new Image()
          probe.onload = () => {
            const ratio = probe.naturalHeight && probe.naturalWidth ? probe.naturalHeight / probe.naturalWidth : 2 / 3
            current.addEl(current.pageIdx, {
              kind: 'image',
              variant: 'illustration',
              src,
              x: 60,
              y: 60,
              w: 300,
              h: Math.round(300 * Math.min(3, Math.max(0.2, ratio))),
            })
          }
          probe.src = src
        })
        return
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

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
