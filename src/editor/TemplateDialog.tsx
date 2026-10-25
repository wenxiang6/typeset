import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EditorApi } from './store'
import {
  defaultTemplate,
  downloadTemplate,
  embedTemplateImages,
  loadSavedTemplates,
  makeTemplate,
  parseTemplateText,
  persistSavedTemplates,
  templateSummary,
  type Template,
} from './templates'
import './templates.css'

export function TemplateDialog({ api, open, onClose }: { api: EditorApi; open: boolean; onClose: () => void }) {
  const [saved, setSaved] = useState<Template[]>([])
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setSaved(loadSavedTemplates())
    setName('')
    setMessage('')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const all = [defaultTemplate(), ...saved]

  const save = async () => {
    setBusy(true)
    setMessage('正在打包图片…')
    const { doc, missing } = await embedTemplateImages(api.doc)
    const t = makeTemplate(name || `我的布局 ${new Date().toLocaleDateString('zh-CN')}`, doc)
    const next = [t, ...saved]
    if (!persistSavedTemplates(next)) {
      setBusy(false)
      setMessage('本地存储空间不足，模板没有保存。可先删除旧模板或减少图片。')
      return
    }
    setSaved(next)
    setName('')
    setBusy(false)
    setMessage(missing ? `模板已保存；有 ${missing} 张本地图片无法打包，分享前建议用「选择本地图片」重新插入。` : '模板已保存到本机。')
  }

  const apply = (t: Template) => {
    api.importDoc(t.doc)
    onClose()
  }

  const share = async (t: Template) => {
    setBusy(true)
    setMessage('正在准备分享文件…')
    const { doc, missing } = await embedTemplateImages(t.doc)
    downloadTemplate({ ...t, doc })
    setBusy(false)
    setMessage(missing ? `分享文件已下载；${missing} 张本地图片无法打包。` : '分享文件已下载，可直接发给其他人导入。')
  }

  const remove = (t: Template) => {
    if (!confirm(`删除模板「${t.name}」？`)) return
    const next = saved.filter((x) => x.id !== t.id)
    persistSavedTemplates(next)
    setSaved(next)
    setMessage('模板已删除。')
  }

  const importFile = async (file: File) => {
    const text = await file.text()
    const t = parseTemplateText(text)
    if (!t) {
      setMessage('模板文件无法识别，请选择本工具导出的 .paiban.json 文件。')
      return
    }
    const next = [t, ...saved]
    if (!persistSavedTemplates(next)) {
      setMessage('本地存储空间不足，导入失败。')
      return
    }
    setSaved(next)
    setMessage(`已导入模板「${t.name}」，点「应用」即可使用。`)
  }

  return createPortal(
    <div
      className="ed-template-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="ed-template-modal" role="dialog" aria-label="模板库">
        <div className="ed-template-head">
          <div>
            <div className="ed-template-title">模板库</div>
            <div className="ed-template-sub">内置现有布局；保存的模板和导入文件都只存本机</div>
          </div>
          <button className="ed-template-close" onClick={onClose} aria-label="关闭模板库">
            ×
          </button>
        </div>

        <div className="ed-template-save">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="模板名称，例如：地理周报 · 期中复习"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) void save()
            }}
          />
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? '处理中…' : '保存当前布局为模板'}
          </button>
        </div>

        <div className="ed-template-grid">
          {all.map((t) => (
            <article className="ed-template-card" key={t.id} data-template-name={t.name}>
              <div className={`ed-template-preview ${t.doc.orientation === 'portrait' ? 'is-portrait' : ''}`}>
                <div className="ed-template-preview-lines">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <span>{t.doc.pages.length} 页</span>
              </div>
              <div className="ed-template-card-body">
                <div className="ed-template-name">
                  {t.name}
                  {t.builtin && <em>内置</em>}
                </div>
                <div className="ed-template-meta">
                  {templateSummary(t)}
                  {!t.builtin && ` · ${new Date(t.createdAt).toLocaleString('zh-CN')}`}
                </div>
                <div className="ed-template-actions">
                  <button className="primary" onClick={() => apply(t)}>
                    应用
                  </button>
                  <button onClick={() => void share(t)}>分享</button>
                  {!t.builtin && (
                    <button className="danger" onClick={() => remove(t)}>
                      删除
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="ed-template-foot">
          <button onClick={() => fileRef.current?.click()}>导入模板文件</button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="ed-hidden-input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void importFile(f)
              e.target.value = ''
            }}
          />
          <span>分享会下载 .paiban.json 文件，对方用「导入模板文件」打开即可；所有模板保存在本机。</span>
        </div>

        {message && <div className="ed-template-message">{message}</div>}
      </div>
    </div>,
    document.body,
  )
}
