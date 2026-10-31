/**
 * 门禁 UI：裸域名门禁页（体验/密码两入口）+ 工具栏体验倒计时 + 到期锁屏。
 * 全部内联样式，不依赖 editor.css，避免污染编辑器样式表。
 */

import { useEffect, useRef, useState } from 'react'
import { confirmNotice } from './confirmNotice'
import { clearGate, currentRemaining, getGate, startTrial, gateLogin, syncRemaining, subscribeGate, type GateState } from './gate'

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/* ---------------- 门禁页（裸域名第一屏） ---------------- */

export function GatePage({ onPass }: { onPass: () => void }) {
  const [busy, setBusy] = useState(false)
  const [pwd, setPwd] = useState('')
  const [error, setError] = useState('')

  const trial = async () => {
    setBusy(true)
    setError('')
    const r = await startTrial()
    setBusy(false)
    if (r.ok) onPass()
    else setError(r.error || '开启体验失败')
  }

  const login = async () => {
    if (!pwd.trim() || busy) return
    setBusy(true)
    setError('')
    const r = await gateLogin(pwd.trim())
    setBusy(false)
    if (r.ok) onPass()
    else setError(r.error || '密码不对')
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', background: '#f6f7f9', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 400, margin: 16, padding: '36px 32px', background: '#fff', borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,.08)', textAlign: 'center' }}>
        <div style={{ fontSize: 42, marginBottom: 6 }}>📰</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#111', marginBottom: 6 }}>地理时政周刊 · 排版编辑器</div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: '#6b7280', marginBottom: 22 }}>
          正式用户请使用管理员发的<strong>个人链接</strong>打开本页。
          <br />
          没有链接？可以限时体验，或输入访问密码。
        </div>

        <button
          onClick={() => void trial()}
          disabled={busy}
          style={{
            width: '100%', padding: '11px 0', fontSize: 15, fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
            background: '#2563eb', color: '#fff', border: 'none', borderRadius: 9, marginBottom: 14,
          }}
        >
          {busy ? '处理中…' : '免费体验 10 分钟'}
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="password"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void login()
            }}
            placeholder="访问密码"
            style={{ flex: 1, padding: '10px 12px', fontSize: 14, border: '1px solid #d1d5db', borderRadius: 9, outline: 'none' }}
          />
          <button
            onClick={() => void login()}
            disabled={busy}
            style={{ padding: '10px 18px', fontSize: 14, cursor: busy ? 'wait' : 'pointer', background: '#f3f4f6', color: '#111', border: '1px solid #d1d5db', borderRadius: 9 }}
          >
            进入
          </button>
        </div>

        {error && <div style={{ marginTop: 14, fontSize: 13, color: '#b91c1c' }}>{error}</div>}
      </div>
    </div>
  )
}

/* ---------------- 工具栏倒计时（体验模式专属） ---------------- */

export function TrialCountdown() {
  const [gate, setGate] = useState<GateState | null>(getGate())
  const [, forceTick] = useState(0)
  const warnedRef = useRef(false)

  useEffect(() => subscribeGate(() => setGate(getGate())), [])

  useEffect(() => {
    if (gate?.mode !== 'trial') return
    // 每 30 秒向服务器校准；每秒本地递减刷新显示
    const sync = () => void syncRemaining()
    void sync()
    const syncId = window.setInterval(sync, 30_000)
    const tickId = window.setInterval(() => forceTick((n) => n + 1), 1000)
    return () => {
      window.clearInterval(syncId)
      window.clearInterval(tickId)
    }
  }, [gate?.mode, gate?.token])

  const remaining = currentRemaining()

  useEffect(() => {
    if (gate?.mode !== 'trial') return
    if (remaining <= 0) {
      window.dispatchEvent(new CustomEvent('paiban-trial-expired'))
      return
    }
    if (remaining <= 30 && !warnedRef.current) {
      warnedRef.current = true
      void confirmNotice({
        tone: 'warn',
        title: '您的体验时间将结束',
        subtitle: '体验剩余不足 30 秒，时间结束后该网站将关闭。可输入访问密码继续使用。',
        okLabel: '知道了',
      })
    }
  }, [remaining, gate?.mode])

  if (gate?.mode !== 'trial') return null
  return (
    <span
      data-tip="<b>体验模式</b>倒计时以服务器时间为准，结束后需要访问密码才能继续"
      style={{ marginLeft: 'auto', font: '600 13px/1 system-ui, sans-serif', color: '#dc2626', whiteSpace: 'nowrap', padding: '0 10px' }}
    >
      体验剩余 {fmt(remaining)}
    </span>
  )
}

/* ---------------- 到期锁屏（覆盖整个编辑器） ---------------- */

export function TrialLock() {
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    const onExpire = () => setExpired(true)
    window.addEventListener('paiban-trial-expired', onExpire)
    // 已过期的令牌（刷新页面）：直接锁
    if (getGate()?.mode === 'trial' && currentRemaining() <= 0) setExpired(true)
    return () => window.removeEventListener('paiban-trial-expired', onExpire)
  }, [])
  if (!expired) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99998, background: 'rgba(17,24,39,.55)', backdropFilter: 'blur(4px)', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 380, margin: 16, padding: '32px 28px', background: '#fff', borderRadius: 14, boxShadow: '0 8px 30px rgba(0,0,0,.25)', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>⏰</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#111', marginBottom: 10 }}>体验时间已结束</div>
        <div style={{ fontSize: 13, lineHeight: 1.7, color: '#4b5563', marginBottom: 20 }}>
          本次编辑内容仍保存在本机，但需要访问密码或个人链接才能继续使用。
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            onClick={() => {
              clearGate()
              window.location.reload()
            }}
            style={{ padding: '9px 20px', fontSize: 14, cursor: 'pointer', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 9 }}
          >
            返回门禁页
          </button>
        </div>
      </div>
    </div>
  )
}
