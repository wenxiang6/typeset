import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EditorApi } from './store'
import type { Doc, Orientation } from './types'
import { openPrintPreview } from './print'
import { TemplateDialog } from './TemplateDialog'
import { Notice, type NoticeData } from './Notice'
import { exportJSON } from './format'
import { importToDoc, type ImportPayload, type MergeMode } from './importDoc'
import { agoText, bytesText, clockText, getSaveState, subscribeSaveState, type SnapshotMeta } from './autosave'
import {
  IconBookmark, IconCopy, IconDownload, IconEye, IconGrid, IconHistory, IconLock, IconMagnet, IconPrint, IconRedo, IconReset,
  IconTrash, IconUndo, IconUnlock, IconUpload,
} from './icons'

const MERGE_KEY = 'paiban-import-merge-v1'

const MERGE_OPTIONS: Array<{ value: MergeMode; label: string; tip: string }> = [
  { value: 'auto', label: '自动', tip: '先排一遍，页数最少且列表不被分页切开的方案' },
  { value: 'merge', label: '合并', tip: '短条目整组一个组件：不会被切开，拖动时是一整块' },
  { value: 'split', label: '拆分', tip: '短条目逐条独立：可以单独拖动、单独调样式' },
]

/** 导入时的目标版式：直接按这套纸张的栏宽量高度、装栏，而不是先排成横版再切 */
const ORIENT_OPTIONS: Array<{ value: Orientation; label: string; tip: string }> = [
  { value: 'landscape', label: '横版', tip: 'A4 横向双栏，和周刊成品一致' },
  { value: 'portrait', label: '竖版', tip: 'A4 纵向双栏，栏更窄、页更高，内容会排更多页' },
]

function readMergeMode(): MergeMode {
  const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(MERGE_KEY)
  return v === 'merge' || v === 'split' ? v : 'auto'
}

export function Toolbar({ api }: { api: EditorApi }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const wordRef = useRef<HTMLInputElement>(null)
  const sel = api.selection ? api.findEl(api.selection) : null
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [wordOpen, setWordOpen] = useState(false)
  const [mergeMode, setMergeMode] = useState<MergeMode>(readMergeMode)
  /** 导入目标版式；默认跟随当前版面，可在这里临时换 */
  const [importOrient, setImportOrient] = useState<Orientation | null>(null)
  const orient: Orientation = importOrient ?? api.orientation ?? 'landscape'
  const [saveOpen, setSaveOpen] = useState(false)
  const [snapList, setSnapList] = useState<SnapshotMeta[]>([])
  const [now, setNow] = useState(() => Date.now())
  // 保存状态走订阅式小仓库：只有这个角标会重渲染，画布完全不受影响
  const saveState = useSyncExternalStore(subscribeSaveState, getSaveState, getSaveState)
  const [notice, setNotice] = useState<NoticeData | null>(null)

  // 快照列表里的「几秒前」需要自己走秒（编辑器不一定会重渲染）
  useEffect(() => {
    if (!saveOpen) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [saveOpen])

  const openSave = () => {
    const next = !saveOpen
    setSaveOpen(next)
    if (next) setSnapList(api.getSnapshots())
  }

  const doRestore = (at: number) => {
    const ok = api.restoreSnapshot(at)
    setSaveOpen(false)
    setNotice(
      ok
        ? {
            tone: 'ok',
            title: `已恢复到 ${clockText(at)} 的版本`,
            subtitle: '按 Ctrl+Z 可以撤销这次恢复，回到你刚才的版面。',
            actions: [{ label: '知道了', primary: true }],
          }
        : {
            tone: 'warn',
            title: '这份快照读不出来',
            subtitle: '可能已被其他编辑覆盖或本机存储被清理，请换一份再试。',
            actions: [{ label: '知道了', primary: true }],
          },
    )
  }

  const setMode = (m: MergeMode) => {
    setMergeMode(m)
    try {
      localStorage.setItem(MERGE_KEY, m)
    } catch {
      /* 隐私模式忽略 */
    }
  }

  /** 导入 Word 原稿：本机解析 → 生成组件 → 替换当前版面（可撤销） */
  const importWord = async (file: File) => {
    setImporting(true)
    try {
      const res = await fetch('/@doc-import', { method: 'POST', body: file })
      const payload = (await res.json()) as ImportPayload
      if (!payload.ok) throw new Error(payload.error || `解析失败（HTTP ${res.status}）`)
      const { doc, warnings, merge, groups, orientation } = await importToDoc(payload, { merge: mergeMode, orientation: orient })
      api.importDoc(doc)
      // 真实高度回填后可能再翻页，以界面上的最终页数为准
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      const bodyCount = doc.pages.reduce(
        (n, p) => n + p.els.filter((e) => !['header', 'masthead', 'footer'].includes(e.variant)).length,
        0,
      )
      const mergeLabel = MERGE_OPTIONS.find((o) => o.value === mergeMode)?.label ?? '自动'
      setNotice({
        tone: warnings.length ? 'warn' : 'ok',
        title: `已导入《${file.name}》`,
        subtitle: groups
          ? `短条目 ${groups} 组，按「${mergeLabel}」处理为${merge === 'merge' ? '合并' : '拆分'}`
          : '内容、组件与页眉页脚已按原稿结构重建',
        stats: [
          { label: '原稿段落', value: String(payload.paragraphs ?? 0) },
          { label: '生成组件', value: String(bodyCount) },
          { label: '版面页数', value: String(api.doc.pages.length) },
          { label: '纸张', value: orientation === 'portrait' ? 'A4 竖版' : 'A4 横版' },
        ],
        notes: warnings,
        hint: '页数由内容量决定；要压缩可点「自动重排」或手动调整，Ctrl+Z 也能撤销。',
        actions: [{ label: '撤销导入', onClick: () => api.undo() }, { label: '知道了', primary: true }],
      })
    } catch (err) {
      const msg = String((err as Error)?.message || err)
      const offline = /Failed to fetch|NetworkError|Load failed/i.test(msg)
      setNotice({
        tone: 'error',
        title: '导入失败',
        subtitle: msg,
        notes: offline ? ['Word 解析需要本机服务：请用 pnpm dev 打开编辑器（双击单文件版没有解析能力）。'] : undefined,
        actions: [{ label: '知道了', primary: true }],
      })
    } finally {
      setImporting(false)
    }
  }

  /** 直接打开打印预览；彩色/黑白在弹窗里切换 */
  const doPrint = () => {
    // 清掉历史遗留的整体灰度（旧版本在编辑器画布上切黑白会留这个 class）
    document.body.classList.remove('ed-bw-preview')
    // 只把纸张页面放进干净的打印窗口，避免编辑器滚动容器导致空白/丢页
    openPrintPreview({
      w: api.doc.w,
      h: api.doc.h,
      orientation: api.doc.orientation ?? 'landscape',
    })
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
        <div className="ed-save-wrap">
          <button
            className={`ed-tb-save${saveOpen ? ' is-on' : ''}`}
            data-tip={
              `<b>自动存档</b>编辑中每 10 秒无感存一份（保留最近 12 份，约 2 分钟）<br>` +
              `上次保存：${saveState.at ? clockText(saveState.at) : '—'}` +
              `${saveState.ok ? '' : `<br><b style="color:#ff7875">${saveState.error ?? '保存失败'}</b>`}`
            }
            onClick={openSave}
          >
            <IconHistory />
            <i className={`ed-save-dot${saveState.ok ? '' : ' is-err'}`} />
          </button>
          {saveOpen && (
            <div className="ed-word-pop ed-save-pop">
              <div className="ed-save-head">
                <span className="ed-save-state">
                  {saveState.ok ? (
                    <>上次保存 {saveState.at ? clockText(saveState.at) : '—'}</>
                  ) : (
                    <b className="is-err">{saveState.error ?? '保存失败'}</b>
                  )}
                </span>
                <button
                  className="ed-word-go ed-save-now"
                  onClick={() => {
                    const ok = api.saveNow()
                    setSnapList(api.getSnapshots())
                    if (!ok) setNotice({
                      tone: 'error',
                      title: '保存失败',
                      subtitle: saveState.error ?? '本机存储可能已满',
                      notes: ['可以先「导出 JSON」把版面存到磁盘，再清理一些快照或换台机器。'],
                      actions: [{ label: '知道了', primary: true }],
                    })
                  }}
                >
                  立即保存
                </button>
              </div>
              <div className="ed-save-list">
                {snapList.length ? (
                  snapList.map((s) => (
                    <button key={s.at} className="ed-save-item" onClick={() => doRestore(s.at)}>
                      <span className="t">{clockText(s.at)}</span>
                      <span className="m">
                        {s.pages} 页 · {s.els} 组件 · {bytesText(s.bytes)}
                      </span>
                      <span className="ago">{agoText(s.at, now)}</span>
                    </button>
                  ))
                ) : (
                  <div className="ed-word-hint">还没有快照。编辑后每 10 秒会自动记一份。</div>
                )}
              </div>
              <div className="ed-word-hint">
                点某一行就能恢复那一版；恢复本身也是一次操作，<b>Ctrl+Z</b> 可以反悔。
                快照只存在本机，关掉软件也不会丢。
              </div>
            </div>
          )}
        </div>
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
                setNotice({
                  tone: 'error',
                  title: 'JSON 解析失败',
                  subtitle: `《${f.name}》不是有效的版面文件`,
                  notes: ['请选择由本编辑器「导出 JSON」生成的文件。'],
                })
              }
            }
            reader.readAsText(f)
            e.target.value = ''
          }}
        />
        <div className="ed-word-wrap">
          <button
            className={`ed-tb-word${wordOpen ? ' is-on' : ''}`}
            disabled={importing}
            onClick={() => setWordOpen((v) => !v)}
            data-tip="<b>导入 Word 原稿</b>选 .doc / .docx / .rtf，本机解析成组件并替换当前版面；图片自动抽出，抽不到的留占位框。<br>可选导入成横版还是竖版，并设置短条目「合并 / 拆分」。需要 pnpm dev 环境"
          >
            {importing ? '解析中…' : 'Word'}
          </button>
          {wordOpen && (
            <div className="ed-word-pop">
              <div className="ed-word-title">导入 Word 原稿</div>
              <button
                className="ed-word-go"
                onClick={() => {
                  setWordOpen(false)
                  wordRef.current?.click()
                }}
              >
                选择文件并导入
              </button>
              <div className="ed-word-row">
                <span className="ed-word-label">版式</span>
                <div className="ed-word-modes">
                  {ORIENT_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      className={orient === o.value ? 'is-on' : ''}
                      data-tip={`<b>${o.label}</b>${o.tip}`}
                      onClick={() => setImportOrient(o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ed-word-row">
                <span className="ed-word-label">短条目</span>
                <div className="ed-word-modes">
                  {MERGE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      className={mergeMode === o.value ? 'is-on' : ''}
                      data-tip={`<b>${o.label}</b>${o.tip}`}
                      onClick={() => setMode(o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ed-word-hint">
                版式默认跟随当前版面（{api.orientation === 'portrait' ? 'A4 竖版' : 'A4 横版'}）；选竖版会直接按竖版的栏宽排版，不是排完再转。
                <br />
                「学习要求」「必考能力」「易错项」这类一条一句的短列表：合并后整组是一个组件，不会被分栏/分页切成两半；拆分则逐条独立，方便单独微调。
              </div>
            </div>
          )}
        </div>
        <input
          ref={wordRef}
          type="file"
          accept=".doc,.docx,.rtf,application/msword"
          className="ed-hidden-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void importWord(f)
          }}
        />
        <button className="ed-template-trigger" data-tip="<b>模板库</b>内置当前布局；可保存/复用/导出分享/导入模板，全部存本机" onClick={() => setTemplatesOpen(true)}>
          <IconBookmark />
          <span>模板</span>
        </button>

        <div className="ed-print-wrap">
          <button
            className="ed-print-trigger"
            data-tip="<b>打印预览</b>直接打开 A4 预览弹窗，彩色/黑白在弹窗标题栏切换；打印时工具栏和选中框自动隐藏"
            onClick={doPrint}
          >
            <IconPrint />
          </button>
        </div>
        <button
          className="is-danger"
          data-tip="<b>重置模板</b>丢弃全部修改，恢复初始版面（可撤销）"
          onClick={() =>
            setNotice({
              tone: 'warn',
              title: '重置为初始模板？',
              subtitle: '当前版面的全部修改将被丢弃。',
              hint: '重置后仍可用 Ctrl+Z 撤销。',
              actions: [{ label: '取消' }, { label: '确认重置', primary: true, onClick: () => api.resetDoc() }],
            })
          }
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
      {notice ? <Notice data={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  )
}

function zoomValue(z: number) {
  const v = Math.round(z * 100)
  return [50, 75, 90, 100, 125, 150, 200, 300, 400].includes(v) ? v : 100
}
