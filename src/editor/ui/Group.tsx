/**
 * 属性面板的可折叠分组。
 *
 * 背景：Inspector 的选项越加越多（位置 / 结构 / 文字 / 颜色 / 外观 / 高级），
 * 平铺下来一屏放不下，得一直往下滚才找得到「底色」。分组之后常用的留在外面，
 * 不常用的折起来，找东西不用滚。
 *
 * 开合状态写 localStorage，刷新后保持——不然每次都要重新展开一遍，比不分组还烦。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

const OPEN_KEY = 'paiban-insp-groups-v1'

function readOpen(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    const obj = raw ? (JSON.parse(raw) as unknown) : null
    return obj && typeof obj === 'object' ? (obj as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function writeOpen(id: string, open: boolean) {
  try {
    const all = readOpen()
    all[id] = open
    localStorage.setItem(OPEN_KEY, JSON.stringify(all))
  } catch {
    /* 隐私模式 / 存储满：忽略，不影响使用 */
  }
}

export function Group({
  id,
  title,
  children,
  defaultOpen = true,
  hint,
}: {
  id: string
  title: string
  children: ReactNode
  defaultOpen?: boolean
  /** 标题右边的浅色补充说明，比如「可选」 */
  hint?: string
}) {
  const [open, setOpen] = useState<boolean>(() => {
    const saved = readOpen()[id]
    return typeof saved === 'boolean' ? saved : defaultOpen
  })

  const toggle = useCallback(() => {
    setOpen((v) => {
      writeOpen(id, !v)
      return !v
    })
  }, [id])

  return (
    <section className={`ed-group${open ? ' is-open' : ''}`}>
      <button type="button" className="ed-group-head" onClick={toggle} aria-expanded={open}>
        <span className="ed-group-caret" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
        <span className="ed-group-title">{title}</span>
        {hint ? <span className="ed-group-hint">{hint}</span> : null}
      </button>
      {open ? <div className="ed-group-body">{children}</div> : null}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * 面板宽度拖拽
 * ------------------------------------------------------------------ */

const WIDTH_KEY = 'paiban-insp-width-v1'
const MIN_W = 260
const MAX_W = 520

export function usePanelWidth() {
  const [width, setWidth] = useState<number>(() => {
    const n = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(n) && n >= MIN_W && n <= MAX_W ? n : 300
  })
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      dragRef.current = { startX: e.clientX, startW: width }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [width],
  )

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    // 面板在右侧：往左拖变宽，所以要取反
    const next = Math.min(MAX_W, Math.max(MIN_W, d.startW - (e.clientX - d.startX)))
    setWidth(next)
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }, [])

  // 松手时落盘，拖的过程中不写，避免每帧都碰 localStorage
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
      } catch {
        /* 忽略 */
      }
    }, 300)
    return () => window.clearTimeout(id)
  }, [width])

  return { width, onPointerDown, onPointerMove, onPointerUp }
}
