import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { EditorApp } from './editor/Editor'
import ViewOnlyApp from './editor/ViewOnlyApp'
import { NewspaperApp } from './newspaper/Newspaper'
import { WordReplicaApp } from './WordReplicaApp'
import { resumeSecretOk } from './resume/secret'
import { resumeToDoc } from './resume/generator'
import { RESUME_PLACEHOLDER } from './resume/data'
import { DOC_KEY } from './editor/autosave'
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
      <Route path="/" element={<EditorApp />} />
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
      <Route path="*" element={<EditorApp />} />
    </Routes>
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
