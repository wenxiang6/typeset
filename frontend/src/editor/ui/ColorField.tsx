/**
 * 统一的颜色选择控件。
 *
 * 背景：Inspector 里「字色」写了两遍、「底色」一遍，每处都是自己 map 一遍预设色，
 * 自定义还是个裸的 <input type="color">（点下去直接弹系统取色器，没法看预设、没法填 HEX）。
 * 现在统一成 ColorField：色块 + HEX 文本，点开一个弹窗，里面有
 * 预设色 / 最近使用 / HEX 输入 / 系统取色器 / 透明与恢复默认。
 *
 * 两种布局：
 *   - 默认：标签在上、整行「色块 + HEX」在下（适合独占一行）
 *   - compact：塞进 4 列栅格里，只显示色块，弹窗向左展开（适合和字体字号并排）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { PRESET_COLORS } from '../format'

const RECENT_KEY = 'paiban-recent-colors-v1'
const MAX_RECENT = 12

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

function pushRecent(color: string) {
  try {
    const next = [color, ...readRecent().filter((c) => c !== color)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
    return next
  } catch {
    return readRecent()
  }
}

/** #abc / #aabbcc / rgb() 都归一成 #rrggbb，给 <input type="color"> 用 */
function toHex(color?: string): string {
  const c = String(color || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{3}$/i.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(c)
  if (m) {
    const h = (n: string) => Math.min(255, Number(n)).toString(16).padStart(2, '0')
    return `#${h(m[1])}${h(m[2])}${h(m[3])}`
  }
  return '#000000'
}

/** 当前值是不是"没设"（空 / inherit / 透明） */
function isUnset(v?: string) {
  return !v || v === 'transparent' || v === 'inherit'
}

export function ColorField({
  label,
  value,
  onChange,
  onClear,
  allowTransparent,
  compact,
}: {
  label: string
  value?: string
  onChange: (color: string) => void
  /** 传了就显示"恢复默认"，不传则不显示 */
  onClear?: () => void
  allowTransparent?: boolean
  /** 紧凑模式：只显示色块，用于和字号等并排 */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [recent, setRecent] = useState<string[]>(() => readRecent())
  const rootRef = useRef<HTMLDivElement>(null)

  // 点面板外 / Esc 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = useCallback(
    (color: string) => {
      setRecent(pushRecent(color))
      onChange(color)
      setOpen(false)
    },
    [onChange],
  )

  const unset = isUnset(value)
  const swatch = unset ? undefined : value
  const text = value === 'transparent' ? '透明' : unset ? '默认' : String(value).toUpperCase()

  const pop = open ? (
    <div className={`ed-colorpop${compact ? ' is-compact' : ''}`} role="dialog">
      <div className="ed-colorpop-title">预设</div>
      <div className="ed-colorpop-grid">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`ed-colorpop-dot${value === c ? ' is-on' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => pick(c)}
          />
        ))}
      </div>

      {recent.length ? (
        <>
          <div className="ed-colorpop-title">最近使用</div>
          <div className="ed-colorpop-grid">
            {recent.map((c) => (
              <button
                key={c}
                type="button"
                className={`ed-colorpop-dot${value === c ? ' is-on' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => pick(c)}
              />
            ))}
          </div>
        </>
      ) : null}

      <div className="ed-colorpop-title">自定义</div>
      <div className="ed-colorpop-custom">
        <input type="color" value={toHex(value)} onChange={(e) => pick(e.target.value)} title="系统取色器" />
        <input
          className="ed-colorpop-hex"
          placeholder="#000000"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const v = draft.trim()
            if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) pick(v.startsWith('#') ? v : `#${v}`)
          }}
        />
        <button
          type="button"
          className="ed-colorpop-apply"
          disabled={!draft.trim()}
          onClick={() => {
            const v = draft.trim()
            if (!v) return
            pick(v.startsWith('#') ? v : `#${v}`)
          }}
        >
          确定
        </button>
      </div>

      <div className="ed-colorpop-foot">
        {allowTransparent ? (
          <button type="button" onClick={() => pick('transparent')}>
            透明
          </button>
        ) : null}
        {onClear ? (
          <button
            type="button"
            onClick={() => {
              onClear()
              setOpen(false)
            }}
          >
            恢复默认
          </button>
        ) : null}
        <button type="button" className="is-plain" onClick={() => setOpen(false)}>
          关闭
        </button>
      </div>
    </div>
  ) : null

  if (compact) {
    return (
      <div className="ed-fg-cell ed-colorfield" ref={rootRef}>
        <span className="ed-fg-label">{label}</span>
        <button
          type="button"
          className="ed-color-trigger is-compact"
          title={text}
          onClick={() => setOpen((v) => !v)}
        >
          <i className={`ed-color-chip${unset ? ' is-empty' : ''}`} style={swatch ? { background: swatch } : undefined} />
          <span className="ed-color-trigger-caret">▾</span>
        </button>
        {pop}
      </div>
    )
  }

  return (
    <div className="ed-field ed-colorfield" ref={rootRef}>
      <span>{label}</span>
      <button type="button" className="ed-color-trigger" onClick={() => setOpen((v) => !v)}>
        <i className={`ed-color-chip${unset ? ' is-empty' : ''}`} style={swatch ? { background: swatch } : undefined} />
        <code>{text}</code>
        <span className="ed-color-trigger-caret">▾</span>
      </button>
      {pop}
    </div>
  )
}
