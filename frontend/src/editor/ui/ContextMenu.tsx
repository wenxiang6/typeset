/**
 * 右键菜单（通用）。
 *
 * 画布上右键组件就用它。位置按鼠标坐标 fixed 定位，靠近窗口边缘时自动翻转，
 * 点外面 / Esc / 滚动都会关掉。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type MenuItem =
  | { label: string; onClick: () => void; disabled?: boolean; hint?: string }
  | { sep: true }
  /** 分组标题（不可点） */
  | { head: string }

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // 贴近窗口右/下边缘时翻到另一侧，避免菜单被切掉
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const left = Math.min(x, window.innerWidth - box.width - 8)
    const top = Math.min(y, window.innerHeight - box.height - 8)
    setPos({ left: Math.max(8, left), top: Math.max(8, top) })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // 滚动就关掉：菜单是 fixed 定位，跟着滚会错位
    const onScroll = () => onClose()
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', onScroll, { passive: true })
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', onScroll)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} className="ed-ctxmenu" style={{ left: pos.left, top: pos.top }} role="menu">
      {items.map((it, i) =>
        'sep' in it ? (
          <div key={`s${i}`} className="ed-ctxmenu-sep" />
        ) : 'head' in it ? (
          <div key={`h${i}`} className="ed-ctxmenu-head">
            {it.head}
          </div>
        ) : (
          <button
            key={it.label}
            type="button"
            className="ed-ctxmenu-item"
            disabled={it.disabled}
            onClick={() => {
              it.onClick()
              onClose()
            }}
          >
            <span>{it.label}</span>
            {it.hint ? <i>{it.hint}</i> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
