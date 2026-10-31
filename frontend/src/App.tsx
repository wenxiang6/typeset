import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { EditorApp } from './editor/Editor'
import ViewOnlyApp from './editor/ViewOnlyApp'
import { NewspaperApp } from './newspaper/Newspaper'
import { WordReplicaApp } from './WordReplicaApp'
import { resumeSecretOk } from './resume/secret'
import { resumeToDoc } from './resume/generator'
import { RESUME_PLACEHOLDER } from './resume/data'
import { DOC_KEY } from './editor/autosave'
import { checkCredentials } from './editor/serverSync'
import './styles/resume.css'

const AdminApp = lazy(() => import('./admin/AdminApp'))

/**
 * 路由（react-router，真路径）：
 * - `/`        排版编辑器（模板可编辑、组件拖拽、格式栏、网格与区域约束）
 * - `/preview` 报纸版只读预览（可直接打印/导出 PDF）
 * - `/word`    1:1 复刻版（按原 Word 文档截图还原）
 * - `/resume`  隐藏后门：简历排版（需正确密钥，否则退回默认编辑器）
 * - `/admin`   后台管理（管用户、发密钥，需 ADMIN_SECRET 登录）
 *
 * 兼容：老链接是 #/preview 这类 hash 形式，进应用后一次性 replace 到真路径（凭证 ?u=&k= 不受影响）。
 */

export default function App() {
  useEffect(() => {
    // 老书签：#/preview 等 hash 形式一次性迁到真路径
    if (window.location.hash && window.location.hash !== '#/') {
      const target = window.location.hash.slice(1)
      if (target.startsWith('/')) {
        window.location.replace(target)
      }
    }
  }, [])

  return (
    <Routes>
      <Route path="/" element={<CredGate><EditorApp /></CredGate>} />
      <Route path="/view" element={<ViewOnlyApp />} />
      <Route path="/preview" element={<NewspaperApp />} />
      <Route path="/word" element={<WordReplicaApp />} />
      <Route
        path="/resume/*"
        element={<ResumeGate />}
      />
      <Route
        path="/admin/*"
        element={
          <Suspense fallback={<AdminLoading />}>
            <AdminApp />
          </Suspense>
        }
      />
      <Route path="*" element={<CredGate><EditorApp /></CredGate>} />
    </Routes>
  )
}

/**
 * 凭证门卫：URL/本机带的凭证若被服务器明确拒绝（401），整页替换成拦截提示，
 * 不让无效链接继续看到编辑器。放行策略宽松——校验只认 401，
 * 网络抖动/超时（unknown）照常放行，绝不误伤正常用户。
 */
function CredGate({ children }: { children: ReactNode }) {
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    let on = true
    void checkCredentials().then((r) => {
      if (on && r === 'invalid') setInvalid(true)
    })
    return () => {
      on = false
    }
  }, [])
  if (!invalid) return <>{children}</>
  return (
    <div
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100vh',
        background: '#f6f7f9',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          margin: 16,
          padding: '32px 28px',
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 8px 30px rgba(0,0,0,.08)',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#b91c1c', marginBottom: 10 }}>访问链接无效</div>
        <div style={{ fontSize: 14, lineHeight: 1.7, color: '#4b5563' }}>
          这个链接里的访问凭证不正确或已被管理员重置。
          <br />
          请使用管理员发给你的<strong>完整个人链接</strong>打开，或联系管理员重新获取。
        </div>
      </div>
    </div>
  )
}

/** 简历后门：密钥匹配时把简历 Doc 注入编辑器主存档，然后就是同一套编辑器 */
function ResumeGate() {
  const loc = useLocation()
  if (resumeSecretOk(loc.search)) {
    try {
      localStorage.setItem(DOC_KEY, JSON.stringify(resumeToDoc(RESUME_PLACEHOLDER)))
    } catch {
      /* 写入失败则回退普通编辑器 */
    }
    return <EditorApp />
  }
  // 密钥不匹配：像没这功能一样，回默认编辑器
  return <EditorApp />
}

function AdminLoading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', font: '14px system-ui' }}>
      后台加载中…
    </div>
  )
}
