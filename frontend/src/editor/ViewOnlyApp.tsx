/**
 * 只读预览（/view?u=&k=）——纯只读的分享落点。
 *
 * 铁律：**只显示服务器稿**。绝不读本机 localStorage 存档（否则在同一台浏览器上
 * 会把本地旧稿冒充成分享内容）。凭证缺失/无效/服务器不可达 → 明确报错，不静默降级。
 * 想微调请用编辑器链接（站点根路径 /?u=&k=）。
 */

import { useEffect, useState } from 'react'
import { EditorApp } from './Editor'
import { fetchServerDocMeta } from './serverSync'
import { viewServerOnly } from './viewMode'

type State = 'loading' | 'ready' | 'error'

export default function ViewOnlyApp() {
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const meta = await fetchServerDocMeta()
      if (cancelled) return
      if (!meta || !meta.raw) {
        setState('error')
        return
      }
      viewServerOnly.on = true
      setState('ready')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'loading') {
    return (
      <div style={centerStyle}>
        <b>正在从服务器读取版面…</b>
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div style={{ ...centerStyle, maxWidth: 560 }}>
        <b>无法读取版面</b>
        <p style={{ lineHeight: 1.8 }}>
          原因二选一：链接里的凭证无效（常见于复制时被截断，注意链接中间不能有空格），
          或服务器暂时不可用。请联系发链接的人重新发一份完整链接。
        </p>
      </div>
    )
  }
  return (
    <div className="vo-root">
      <style>{viewOnlyCss}</style>
      <div className="vo-banner">
        <span>只读预览 · 要微调请让管理员发编辑器链接</span>
        <button className="vo-print" onClick={() => window.print()}>
          打印 / 导出 PDF
        </button>
      </div>
      <EditorApp />
    </div>
  )
}

const centerStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 24,
  textAlign: 'center',
  font: '14px system-ui, sans-serif',
  color: '#333',
}

const viewOnlyCss = `
.vo-root .ed-app > :not(.ed-body) { display: none !important; }
.vo-root .ed-side { display: none !important; }
.vo-root .ed-canvas-bar { display: none !important; }
.vo-root .ed-canvas, .vo-root .ed-canvas * { pointer-events: none !important; }
.vo-root .ed-app { padding-top: 0 !important; }
@media print {
  .vo-banner { display: none !important; }
}
.vo-banner {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  background: #111;
  color: #fff;
  font: 13px system-ui, sans-serif;
}
.vo-print {
  font: 13px system-ui;
  padding: 4px 14px;
  border: none;
  border-radius: 6px;
  background: #185FA5;
  color: #fff;
  cursor: pointer;
}
`
