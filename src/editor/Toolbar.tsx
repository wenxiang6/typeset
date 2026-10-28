import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { EditorApi } from './store'
import type { Doc, Orientation } from './types'
import { openPrintPreview } from './print'
import { TemplateDialog } from './TemplateDialog'
import { Notice, type NoticeData } from './Notice'
import { exportJSON } from './format'
import { importToDoc, type ImportPayload, type MergeMode } from './importDoc'
import { agoText, bytesText, clockText, getSaveState, subscribeExternalDoc, subscribeSaveState, type SnapshotMeta } from './autosave'
import { sanitizeDocHtmls } from './sanitize'
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

/**
 * 探一下 Word 解析服务在不在。
 *
 * 静态托管（dist 单文件扔 nginx / OSS / Pages）没有 POST /@doc-import 端点，
 * 请求会落到 index.html 或 404 页面；file:// 下直接连不上。
 * 点之前就知道，比点完弹一堆 HTML 片段友好得多。
 */
async function probeImportService(): Promise<{ ready: boolean; reason: string }> {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return { ready: false, reason: '单文件版（双击打开）没有解析服务' }
  }
  try {
    const res = await fetch('/@doc-import', { method: 'GET' })
    const raw = await res.text()
    // 服务端对 GET 会回 405 + JSON {"ok":false,"error":"只支持 POST"}
    const ok = res.status === 405 && raw.trimStart().startsWith('{')
    if (ok) return { ready: true, reason: '' }
    return { ready: false, reason: '当前是静态托管，没有解析端点（nginx / OSS / Pages 只发文件，跑不了解析）' }
  } catch {
    return { ready: false, reason: '连不上解析服务' }
  }
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
  /** null = 探测中；false = 明确没有解析服务，会把 Word 按钮置灰并说明怎么办 */
  const [svc, setSvc] = useState<{ ready: boolean; reason: string } | null>(null)

  useEffect(() => {
    let alive = true
    probeImportService().then((r) => {
      if (alive) setSvc(r)
    })
    return () => {
      alive = false
    }
  }, [])

  /* —— 保存失败要主动喊一声（每次失败只弹一次，恢复后允许再弹） —— */
  const saveErrShown = useRef(false)
  useEffect(() => {
    if (!saveState.ok) saveErrShown.current = false
  }, [saveState.ok])
  useEffect(() => {
    const onSaveError = (e: Event) => {
      if (saveErrShown.current) return
      saveErrShown.current = true
      const detail = (e as CustomEvent<{ error?: string }>).detail
      setNotice({
        tone: 'error',
        title: '自动保存失败',
        subtitle: detail?.error ?? '本机存储可能已满',
        notes: [
          '「立即导出 JSON」把版面先落到磁盘，内容不会丢。',
          '存档恢复后（删掉一些图片或快照）会自动继续保存。',
        ],
        actions: [{ label: '导出 JSON', primary: true, onClick: () => exportJSON(api.getDoc()) }, { label: '知道了' }],
      })
    }
    window.addEventListener('paiban-save-error', onSaveError)
    return () => window.removeEventListener('paiban-save-error', onSaveError)
  }, [api])

  /* —— 保存失败状态下关窗口：给一次反悔机会（正常情况 400ms 已落盘，不打扰） —— */
  useEffect(() => {
    if (saveState.ok) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [saveState.ok])

  /* —— 检测到另一个窗口改写了存档：让用户选，不静默覆盖 —— */
  const externalRawRef = useRef('')
  useEffect(() => {
    const unsub = subscribeExternalDoc((raw) => {
      externalRawRef.current = raw
      setNotice({
        tone: 'warn',
        title: '检测到另一个窗口修改了这份版面',
        subtitle: '同一浏览器的多个标签/窗口共用一份自动存档，同时编辑会互相覆盖。',
        notes: [
          '「载入它的版本」= 放弃本窗口的当前内容（可以 Ctrl+Z 反悔）。',
          '「保留我的」= 本窗口继续编辑，落盘时会盖掉另一个窗口的内容。',
        ],
        actions: [
          { label: '载入它的版本', primary: true, onClick: () => api.loadExternalDoc() },
          { label: '保留我的' },
        ],
      })
    })
    return unsub
  }, [api])

  /* —— 快捷键速查：? 按钮 / Ctrl+/ —— */
  const [showKeys, setShowKeys] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        setShowKeys((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!showKeys) return
    setNotice({
      tone: 'ok',
      title: '快捷键速查',
      notes: [
        'Ctrl+Z / Ctrl+Y —— 撤销 / 重做',
        'Ctrl+C / Ctrl+X / Ctrl+V —— 复制 / 剪切 / 粘贴选中组件（可跨页）',
        'Ctrl+D —— 原地复制一份（右下偏移 16px）',
        'Shift + 点击 —— 按阅读顺序连选多块 · Cmd/Ctrl + 点击 —— 加选 / 取消某一块',
        '空白处拖动 —— 框选多个组件（按住 Shift 是加选）· Ctrl+A —— 选中本页全部',
        '选中多块后右键 —— 「合并为一块」把同类型的块拼回去',
        'Delete / Backspace —— 删除选中组件（多选时一起删）',
        '方向键 —— 与上下左右相邻的组件交换位置',
        'Alt + 方向键 —— 微调 1px（再按住 Shift 变 10px）',
        'Ctrl+/ —— 打开本速查 · Esc —— 关闭弹窗 / 取消编辑',
        'Ctrl+滚轮 —— 缩放画布 · Ctrl+P —— 打印预览',
      ],
      hint: '在文字框里输入时快捷键不生效（保留原生的复制粘贴行为）。',
    })
    setShowKeys(false)
  }, [showKeys])

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
      const raw = await res.text()
      let payload: ImportPayload
      try {
        payload = JSON.parse(raw) as ImportPayload
      } catch {
        // nginx / OSS / Pages 这类纯静态托管没有这个端点，会返回 index.html 或 404 页面
        const looksHtml = /^\s*<(!doctype|html)/i.test(raw)
        throw new Error(
          looksHtml
            ? 'STATIC_HOST'
            : `服务端返回了非 JSON（HTTP ${res.status}）${raw.slice(0, 120)}`,
        )
      }
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
      const rawMsg = String((err as Error)?.message || err)
      const staticHost = rawMsg === 'STATIC_HOST'
      const offline = /Failed to fetch|NetworkError|Load failed/i.test(rawMsg)
      setNotice({
        tone: 'error',
        title: staticHost ? '当前没有解析服务' : '导入失败',
        subtitle: staticHost
          ? 'Word 解析需要一个 Node 服务，不是纯前端能力。现在这个页面是静态托管的（dist 单文件 → nginx / OSS / Pages），缺少 POST /@doc-import 端点。'
          : rawMsg,
        notes: staticHost
          ? [
              '在服务器上改用 Node 服务托管（不要只扔静态文件）：',
              'pnpm build && pnpm serve --host 0.0.0.0 --port 8080',
              'pnpm serve --check   # 只体检本机/服务器有没有可用的 Word 转换器',
              'Linux 服务器还要装转换器：apt install libreoffice-writer（或 yum install libreoffice-writer）',
              '临时代替：在自己电脑上用桌面版或 pnpm dev 导入，导出 JSON 后在服务器版的模板里载入。',
            ]
          : offline
            ? ['本机 / 服务器上的解析服务没连上：确认 pnpm dev（或 pnpm serve）正在跑。']
            : undefined,
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
              (saveState.dirty
                ? '状态：编辑中（还没落盘）<br>'
                : `上次保存：${saveState.at ? clockText(saveState.at) : '—'}<br>`) +
              `${saveState.ok ? '' : `<b style="color:#ff7875">${saveState.error ?? '保存失败'}</b>`}`
            }
            onClick={openSave}
          >
            <IconHistory />
            <i className={`ed-save-dot${saveState.ok ? (saveState.dirty ? ' is-dirty' : '') : ' is-err'}`} />
          </button>
          {saveOpen && (
            <div className="ed-word-pop ed-save-pop">
              <div className="ed-save-head">
                <span className="ed-save-state">
                  {saveState.ok ? (
                    <>
                      {saveState.dirty ? (
                        <>
                          编辑中 <span className="ed-save-when">· 上次保存 {saveState.at ? clockText(saveState.at) : '—'}</span>
                        </>
                      ) : (
                        <>上次保存 {saveState.at ? clockText(saveState.at) : '—'}</>
                      )}
                    </>
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
                // 外部文件不信任：统一过 HTML 白名单净化（幂等，自家导出的也不受影响）
                api.importDoc(sanitizeDocHtmls(JSON.parse(String(reader.result)) as Doc))
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
            disabled={importing || svc === null || (svc !== null && !svc.ready)}
            onClick={() => setWordOpen((v) => !v)}
            data-tip={
              svc && !svc.ready
                ? `<b>Word 解析不可用</b>${svc.reason}。<br><br>要用 Node 服务托管：<br><code>pnpm build &amp;&amp; pnpm serve --host 0.0.0.0 --port 8080</code><br>Linux 服务器还需装转换器：<code>apt install libreoffice-writer</code><br><br>临时代替：在自己电脑上用桌面版，或 <code>pnpm dev</code> 导入后导出 JSON 再载入。`
                : '<b>导入 Word 原稿</b>选 .doc / .docx / .rtf，本机解析成组件并替换当前版面；图片自动抽出，抽不到的留占位框。<br>可选导入成横版还是竖版，并设置短条目「合并 / 拆分」。'
            }
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
