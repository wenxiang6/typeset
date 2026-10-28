import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface NoticeStat {
  label: string
  value: string
}

export interface NoticeAction {
  label: string
  primary?: boolean
  onClick?: () => void
}

export interface NoticeData {
  tone?: 'ok' | 'warn' | 'error'
  title: string
  subtitle?: string
  /** 关键数字，一行并排显示 */
  stats?: NoticeStat[]
  /** 需要注意的条目（黄色提示块） */
  notes?: string[]
  /** 底部灰色小字 */
  hint?: string
  actions?: NoticeAction[]
}

/**
 * 应用内通知弹窗（替代 alert）。
 * 玻璃态卡片，和模板库/打印预览保持同一套视觉。
 */
export function Notice({ data, onClose }: { data: NoticeData; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const tone = data.tone ?? 'ok'
  const actions = data.actions?.length ? data.actions : [{ label: '知道了', primary: true }]

  const body = (
    <div
      className="ed-notice-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`ed-notice is-${tone}`} role="dialog" aria-modal="true" aria-label={data.title}>
        <div className="ed-notice-head">
          <span className="ed-notice-badge" aria-hidden="true">
            {tone === 'ok' ? '✓' : tone === 'warn' ? '!' : '!'}
          </span>
          <div className="ed-notice-titles">
            <div className="ed-notice-title">{data.title}</div>
            {data.subtitle ? <div className="ed-notice-sub">{data.subtitle}</div> : null}
          </div>
          <button className="ed-notice-x" onClick={onClose} aria-label="关闭" title="关闭（Esc）">
            ✕
          </button>
        </div>

        {data.stats?.length ? (
          <div className="ed-notice-stats">
            {data.stats.map((s) => (
              <div className="ed-notice-stat" key={s.label}>
                <b>{s.value}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        ) : null}

        {data.notes?.length ? (
          <ul className="ed-notice-notes">
            {data.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : null}

        {data.hint ? <div className="ed-notice-hint">{data.hint}</div> : null}

        <div className="ed-notice-foot">
          {actions.map((a) => (
            <button
              key={a.label}
              className={a.primary ? 'primary' : ''}
              onClick={() => {
                a.onClick?.()
                onClose()
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  // 挂到 body：工具栏带 backdrop-filter，会让 position:fixed 相对工具栏定位，弹窗会被挤到顶部
  return createPortal(body, document.body)
}
