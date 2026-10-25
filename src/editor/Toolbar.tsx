import { useRef, useState } from 'react'
import type { EditorApi } from './store'
import type { Doc } from './types'
import { openPrintPreview } from './print'
import { TemplateDialog } from './TemplateDialog'
import { exportJSON } from './format'
import {
  IconBookmark, IconCopy, IconDownload, IconEye, IconGrid, IconLock, IconMagnet, IconPrint, IconRedo, IconReset,
  IconTrash, IconUndo, IconUnlock, IconUpload,
} from './icons'

export function Toolbar({ api }: { api: EditorApi }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const sel = api.selection ? api.findEl(api.selection) : null
  const [printOpen, setPrintOpen] = useState(false)
  const [printMode, setPrintMode] = useState<'color' | 'bw'>('color')
  const [templatesOpen, setTemplatesOpen] = useState(false)

  const applyPrintMode = (mode: 'color' | 'bw') => {
    setPrintMode(mode)
    document.body.classList.toggle('ed-bw-preview', mode === 'bw')
  }

  const doPrint = () => {
    document.body.classList.toggle('ed-bw-preview', printMode === 'bw')
    // 只把纸张页面放进干净的打印窗口，避免编辑器滚动容器导致空白/丢页
    openPrintPreview({
      w: api.doc.w,
      h: api.doc.h,
      orientation: api.doc.orientation ?? 'landscape',
      bw: printMode === 'bw',
    })
    setPrintOpen(false)
  }

  return (
    <div className="ed-toolbar">
      <div className="ed-brand">排版编辑器</div>

      <div className="ed-tb-group">
        <button onClick={api.undo} disabled={!api.past.length} data-tip="<b>撤销</b>取消上一步操作 <span class='kbd'>Ctrl+Z</span>">
          <IconUndo />
        </button>
        <button onClick={api.redo} disabled={!api.future.length} data-tip="<b>重做</b>恢复上一步撤销的操作 <span class='kbd'>Ctrl+Shift+Z</span>">
          <IconRedo />
        </button>
      </div>

      <div className="ed-tb-group">
        <button
          onClick={() => api.selection && api.duplicateEl(api.selection)}
          disabled={!api.selection}
          data-tip="<b>复制</b>复制选中元素并偏移 16px <span class='kbd'>Ctrl+D</span>"
        >
          <IconCopy />
        </button>
        <button
          onClick={() => api.selection && api.removeEl(api.selection)}
          disabled={!api.selection}
          data-tip="<b>删除</b>删除选中元素 <span class='kbd'>Delete</span>"
        >
          <IconTrash />
        </button>
        <button
          onClick={() => api.selection && api.toggleLock(api.selection)}
          disabled={!api.selection}
          data-tip={sel?.locked ? '<b>解锁</b>解除后可继续拖动/缩放' : '<b>锁定</b>锁定后不可拖动、缩放或删除'}
        >
          {sel?.locked ? <IconUnlock /> : <IconLock />}
        </button>
      </div>

      <div className="ed-tb-group">
        <button
          className={api.grid.show ? 'is-on' : ''}
          onClick={() => api.setGrid({ ...api.grid, show: !api.grid.show })}
          data-tip="<b>网格</b>显示/隐藏页面方格网（按格子大小）"
        >
          <IconGrid />
        </button>
        <button
          className={api.grid.snap ? 'is-on' : ''}
          onClick={() => api.setGrid({ ...api.grid, snap: !api.grid.snap })}
          data-tip="<b>吸附</b>拖动与缩放自动对齐到最近的网格线"
        >
          <IconMagnet />
        </button>
        <label className="ed-tb-inline" data-tip="<b>格子大小</b>网格与吸附的粒度，也是方向键的移动步长">
          格子
          <select value={api.grid.cell} onChange={(e) => api.setGrid({ ...api.grid, cell: parseInt(e.target.value, 10) })}>
            {[4, 8, 12, 16, 24].map((c) => (
              <option key={c} value={c}>
                {c}px
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ed-tb-group">
        <label className="ed-tb-inline" data-tip="<b>页面</b>切换到指定页进行排版">
          页
          <select value={api.pageIdx} onChange={(e) => api.setPageIdx(parseInt(e.target.value, 10))}>
            {api.doc.pages.map((p, i) => (
              <option key={p.id} value={i}>
                第 {i + 1} 页
              </option>
            ))}
          </select>
        </label>
        <label className="ed-tb-inline" data-tip="<b>缩放</b>只缩放中间模板；也可在模板上双指捏合（Ctrl+滚轮）">
          缩放
          <select value={zoomValue(api.zoom)} onChange={(e) => api.setZoom(parseInt(e.target.value, 10) / 100)}>
            {[50, 75, 90, 100, 125, 150, 200, 300, 400].map((z) => (
              <option key={z} value={z}>
                {z}%
              </option>
            ))}
          </select>
        </label>
        <span className="ed-page-count">共 {api.doc.pages.length} 页</span>
        <button
          data-tip="<b>横竖版切换</b>全局切换 A4 横版 / 竖版，内容自动重排、溢出翻页"
          onClick={() => api.setOrientation(api.orientation === 'portrait' ? 'landscape' : 'portrait')}
        >
          {api.orientation === 'portrait' ? '横版' : '竖版'}
        </button>
        <button data-tip="<b>新增一页</b>在文档末尾追加一页（自动带页眉页脚）" onClick={api.addPage}>
          ＋页
        </button>
        <button data-tip="<b>自动重排</b>重新测量文字高度、消除重叠、把溢出内容分页（也可用于修复旧版面）" onClick={api.reflow}>
          自动重排
        </button>
      </div>

      <div className="ed-tb-group">
        <button data-tip="<b>导出 JSON</b>把整份版面保存为 .json 文件（可用导入还原）" onClick={() => exportJSON(api.doc)}>
          <IconDownload />
        </button>
        <button data-tip="<b>导入 JSON</b>载入之前导出的版面文件" onClick={() => fileRef.current?.click()}>
          <IconUpload />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="ed-hidden-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const reader = new FileReader()
            reader.onload = () => {
              try {
                api.importDoc(JSON.parse(String(reader.result)) as Doc)
              } catch {
                alert('JSON 解析失败')
              }
            }
            reader.readAsText(f)
            e.target.value = ''
          }}
        />
        <button className="ed-template-trigger" data-tip="<b>模板库</b>内置当前布局；可保存/复用/导出分享/导入模板，全部存本机" onClick={() => setTemplatesOpen(true)}>
          <IconBookmark />
          <span>模板</span>
        </button>

        <div className="ed-print-wrap">
          <button
            className={`ed-print-trigger${printOpen ? ' is-on' : ''}`}
            data-tip="<b>打印设置</b>先选彩色/黑白预览，再打印或导出 PDF；打印时工具栏和选中框自动隐藏"
            onClick={() => setPrintOpen((v) => !v)}
          >
            <IconPrint />
          </button>
          {printOpen && (
            <div className="ed-print-pop">
              <div className="ed-print-title">打印预览</div>
              <div className="ed-print-modes">
                <button className={printMode === 'color' ? 'is-on' : ''} onClick={() => applyPrintMode('color')}>
                  彩色预览
                </button>
                <button className={printMode === 'bw' ? 'is-on' : ''} onClick={() => applyPrintMode('bw')}>
                  黑白预览
                </button>
              </div>
              <div className="ed-print-hint">预览只改变画面颜色，不会改变页数。会打开应用内 A4 打印预览，在预览里点「打印 / 保存 PDF」。</div>
              <button className="ed-print-go" onClick={doPrint}>
                打开打印预览
              </button>
            </div>
          )}
        </div>
        <button
          className="is-danger"
          data-tip="<b>重置模板</b>丢弃全部修改，恢复初始版面（可撤销）"
          onClick={() => {
            if (confirm('重置为初始模板？当前修改将丢失。')) api.resetDoc()
          }}
        >
          <IconReset />
        </button>
      </div>

      <div className="ed-tb-group">
        <a className="ed-link" href="#/preview" target="_blank" rel="noreferrer" data-tip="<b>预览</b>新窗口打开报纸版只读预览（含水印与打印按钮）">
          <IconEye />
        </a>
        <a className="ed-link" href="#/word" target="_blank" rel="noreferrer" data-tip="<b>1:1 版</b>按 Word 原图逐像素复刻的 8 开试卷版">
          1:1
        </a>
      </div>
      <TemplateDialog api={api} open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
    </div>
  )
}

function zoomValue(z: number) {
  const v = Math.round(z * 100)
  return [50, 75, 90, 100, 125, 150, 200, 300, 400].includes(v) ? v : 100
}
