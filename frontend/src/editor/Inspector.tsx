import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorApi } from './store'
import { findRegion, getGeometry, isFurniture, resolveMove } from './layout'
import { componentName } from './componentNames'
import { FONT_FAMILIES, FONT_SIZES, LETTER_SPACINGS, LINE_HEIGHTS } from './format'
import { buildTable, parseTable, resizeCols, resizeRows, setCell, setHeader } from './table'
import { buildList, parseList, switchListType, OL_TEMPLATES, UL_TEMPLATES } from './list'
import { buildChain, parseChain } from './chain'
import { confirmNotice, popNotice } from './confirmNotice'
import { fileToCompactDataURL } from './imageTools'
import { Group, usePanelWidth } from './ui/Group'
import { ColorField } from './ui/ColorField'
import { FieldGrid, NumField, Row, SelectField } from './ui/fields'
import { HtmlDrawer } from './ui/HtmlDrawer'
import { countParts } from './split'

const LINE_WIDTHS = [1, 2, 3, 4, 6, 8]


export function Inspector({ api }: { api: EditorApi }) {
  const panel = usePanelWidth()
  const sel = api.selection ? api.findEl(api.selection) : null
  /** 多选集合（含主选中） */
  const multiIds = api.selectedIds
  /**
   * 外观改动的落点：多选时是整组，单选时就是这一块。
   * 位置 / 尺寸（x/y/w/h）不走这里——每块大小本来就不同，批量设同一个值会毁版面。
   */
  const setStyle = (patch: Parameters<EditorApi['updateStyle']>[1]) => {
    if (!sel) return
    if (multiIds.length > 1) api.updateStyleMany(multiIds, patch)
    else api.updateStyle(sel.id, patch)
  }
  const [htmlOpen, setHtmlOpen] = useState(false)
  /** 打开抽屉那一刻的 html，取消时用它还原 */
  const [htmlBase, setHtmlBase] = useState('')
  // 换选中对象时把抽屉收起来，免得上一个组件的草稿留在屏上
  useEffect(() => setHtmlOpen(false), [api.selection])
  /** 当前组件能拆成几段（按根元素的子节点数） */
  const partCount = useMemo(() => (sel?.html ? countParts(sel.html) : 0), [sel?.html])
  const tableModel = useMemo(() => (sel?.variant === 'table' ? parseTable(sel.html) : null), [sel?.variant, sel?.html])
  const listModel = useMemo(() => (sel?.variant === 'ulist' || sel?.variant === 'olist' ? parseList(sel.html) : null), [sel?.variant, sel?.html])
  const chainModel = useMemo(() => (sel?.variant === 'chain' ? parseChain(sel.html) : null), [sel?.variant, sel?.html])
  const subParts = useMemo(() => {
    if (!sel?.html) return []
    const parsed = new DOMParser().parseFromString(sel.html, 'text/html')
    const root = parsed.body.firstElementChild
    if (!root) return []
    return Array.from(root.children)
      .map((node, index) => ({ index, text: (node.textContent || '').replace(/\s+/g, ' ').trim() }))
      .filter((p) => p.text)
  }, [sel?.html])
  const style = sel?.style ?? {}
  const imgRef = useRef<HTMLInputElement>(null)
  const qrRef = useRef<HTMLInputElement>(null)
  const flow = api.doc.flow ?? { autoHeight: true, autoPage: true }
  const isPortrait = api.orientation === 'portrait'
  const selPageIdx = api.doc.pages.findIndex((p) => p.els.some((e) => e.id === api.selection))
  const [targetPage, setTargetPage] = useState(0)

  useEffect(() => {
    if (selPageIdx >= 0) setTargetPage(selPageIdx)
  }, [api.selection, selPageIdx])

  if (!sel) {
    return (
      <div className="ed-inspector" style={{ width: panel.width }}>
      <div
        className="ed-insp-resize"
        title="拖动调整面板宽度"
        onPointerDown={panel.onPointerDown}
        onPointerMove={panel.onPointerMove}
        onPointerUp={panel.onPointerUp}
      />
        <div className="ed-panel-title">页面设置</div>
        <div className="ed-insp-body">
          <div className="ed-insp-row">
            <span>纸张</span>
            <button className={!isPortrait ? 'is-on' : ''} onClick={() => api.setOrientation('landscape')}>
              A4 横版
            </button>
            <button className={isPortrait ? 'is-on' : ''} onClick={() => api.setOrientation('portrait')}>
              A4 竖版
            </button>
          </div>
          <div className="ed-insp-note">
            当前 {Math.round(api.doc.w * 100) / 100} × {Math.round(api.doc.h * 100) / 100} px（{isPortrait ? 'A4 竖向 210×297mm' : 'A4 横向 297×210mm'}，96dpi 标准换算）。
            版心按 A4 纸固定计算（左右 12mm / 页眉 10mm / 页脚距底 16mm），切换方向会重算双栏宽度；页眉/报头/页脚移动不会牵动正文分页。
          </div>

          <div className="ed-panel-title">页码 / 页面</div>
          <div className="ed-insp-row">
            {api.doc.pages.map((p, i) => (
              <button key={p.id} className={i === api.pageIdx ? 'is-on' : ''} onClick={() => api.setPageIdx(i)}>
                第 {i + 1} 页
              </button>
            ))}
          </div>
          <div className="ed-insp-row">
            <button onClick={api.addPage}>＋ 新增一页</button>
            <button
              className="is-danger"
              disabled={api.doc.pages.length <= 1}
              onClick={async () => {
                const ok = await confirmNotice({
                  tone: 'warn',
                  title: `删除第 ${api.pageIdx + 1} 页？`,
                  subtitle: '该页内容会一并删除（可以 Ctrl+Z 反悔）。',
                  okLabel: '删除',
                })
                if (!ok) return
                api.setSelection(null)
                api.removePage(api.pageIdx)
              }}
            >
              删除当前页
            </button>
          </div>
          <div className="ed-insp-note">
            共 {api.doc.pages.length} 页。页脚页码会自动更新为「当前页 / 总页数」。
          </div>

          <div className="ed-panel-title">自动排版（WPS 式）</div>
          <div className="ed-insp-row">
            <button className={flow.autoHeight ? 'is-on' : ''} onClick={() => api.setFlow({ autoHeight: !flow.autoHeight })}>
              文字自动高度
            </button>
            <button className={flow.autoPage ? 'is-on' : ''} onClick={() => api.setFlow({ autoPage: !flow.autoPage })}>
              超出自动翻页
            </button>
          </div>
          <div className="ed-insp-row">
            <button onClick={() => api.reflow()}>立即重排</button>
            <button
              onClick={async () => {
                const ok = await confirmNotice({
                  tone: 'warn',
                  title: '重建分页？',
                  subtitle: '会按阅读顺序重新排版全部内容（区域辅助框会丢弃）。',
                  okLabel: '重建',
                })
                if (ok) api.repair()
              }}
            >
              重建分页 / 修复空白页
            </button>
          </div>
          <div className="ed-insp-note">
            打开「文字自动高度」后，文字块会按真实内容伸缩，下方组件自动下推；
            到页底的组件整体流到下一页顶部，不会拆断标题、边框和颜色。
            如果误拖页眉/报头导致第一页内容被搬走，用「重建分页」按阅读顺序装回。
          </div>

          <div className="ed-panel-title">默认正文（黑体五号）</div>
          <label className="ed-field">
            <span>默认字体</span>
            <select
              value={api.doc.defaults.fontFamily}
              onChange={(e) => api.updatePage({ defaults: { ...api.doc.defaults, fontFamily: e.target.value } })}
            >
              <option value='"Lantinghei SC","PingFang SC","Heiti SC","SimHei","Microsoft YaHei",sans-serif'>黑体（默认）</option>
              <option value='"Songti SC","SimSun","Noto Serif SC",serif'>宋体</option>
              <option value='"Kaiti SC","KaiTi","STKaiti",serif'>楷体</option>
              <option value='"STFangsong","FangSong","FangSong_GB2312",serif'>仿宋</option>
            </select>
          </label>
          <label className="ed-field">
            <span>默认字号</span>
            <select
              value={api.doc.defaults.fontSize}
              onChange={(e) => api.updatePage({ defaults: { ...api.doc.defaults, fontSize: e.target.value } })}
            >
              <option value="14px">五号（10.5pt / 14px，默认）</option>
              <option value="12px">小五（9pt / 12px）</option>
              <option value="16px">小四（12pt / 16px）</option>
              <option value="18.7px">四号（14pt / 18.7px）</option>
              <option value="21.3px">三号（16pt / 21.3px）</option>
              <option value="24px">小二（18pt / 24px）</option>
            </select>
          </label>
          <div className="ed-insp-row">
            <button onClick={() => api.applyDefaultsToBody()}>应用到全部正文</button>
          </div>

          <div className="ed-panel-title">水印</div>
          <label className="ed-field">
            <span>水印文字</span>
            <input
              value={api.doc.watermark.text}
              onChange={(e) => api.updatePage({ watermark: { ...api.doc.watermark, text: e.target.value } })}
            />
          </label>
          <NumField label="字号" value={api.doc.watermark.size} onChange={(v) => api.updatePage({ watermark: { ...api.doc.watermark, size: v } })} />
          <label className="ed-field">
            <span>透明度 {api.doc.watermark.opacity}</span>
            <input
              type="range"
              min={0.02}
              max={0.6}
              step={0.01}
              value={api.doc.watermark.opacity}
              onChange={(e) => api.updatePage({ watermark: { ...api.doc.watermark, opacity: parseFloat(e.target.value) } })}
            />
          </label>
          <NumField label="角度" value={api.doc.watermark.angle} onChange={(v) => api.updatePage({ watermark: { ...api.doc.watermark, angle: v } })} />

          <div className="ed-panel-title">网格</div>
          <div className="ed-insp-row">
            <button className={api.grid.show ? 'is-on' : ''} onClick={() => api.setGrid({ ...api.grid, show: !api.grid.show })}>
              显示网格
            </button>
            <button className={api.grid.snap ? 'is-on' : ''} onClick={() => api.setGrid({ ...api.grid, snap: !api.grid.snap })}>
              吸附网格
            </button>
          </div>
          <div className="ed-insp-row">
            <span>格子</span>
            {[4, 8, 12, 16, 24].map((c) => (
              <button key={c} className={api.grid.cell === c ? 'is-on' : ''} onClick={() => api.setGrid({ ...api.grid, cell: c })}>
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const region = findRegion(api.doc, api.pageIdx, sel, sel.id)
  const furniture = isFurniture(sel)

  /** 数值改位/改大小：同样走避让 + 区域约束 + 分页；改高度会关闭自动高度 */
  const setRect = (patch: Partial<{ x: number; y: number; w: number; h: number }>) => {
    const doc = api.getDoc()
    const live = doc.pages[api.pageIdx]?.els.find((e) => e.id === sel.id)
    if (!live) return
    const prev = { x: live.x, y: live.y, w: live.w, h: live.h }
    const desired = { ...prev, ...patch }
    const regionEl = findRegion(doc, api.pageIdx, prev, live.id)
    api.beginTx()
    const res = resolveMove(doc, api.pageIdx, live.id, desired, prev, regionEl ? { x: regionEl.x, y: regionEl.y, w: regionEl.w, h: regionEl.h } : null)
    api.updateEl(live.id, res.rect, false)
    res.pushed.forEach((rect, pid) => api.updateEl(pid, rect, false))
    if (patch.h !== undefined) api.updateEl(live.id, { autoHeight: false }, false)
    api.endTx()
  }

  const addTableRow = () => {
    if (!tableModel) return
    const node = document.querySelector<HTMLElement>(`[data-el-id="${sel.id}"]`)
    const trs = Array.from(node?.querySelectorAll('tbody tr') ?? [])
    const last = trs[trs.length - 1]
    const lastH = last ? last.getBoundingClientRect().height / api.zoom : 0
    api.updateEl(sel.id, { html: buildTable(resizeRows(tableModel, 1, lastH)) }, true)
  }

  const clearTable = () => {
    if (!tableModel) return
    const next = {
      ...tableModel,
      headers: tableModel.headers.map(() => ''),
      rows: tableModel.rows.map((r) => r.map(() => '')),
    }
    api.updateEl(sel.id, { html: buildTable(next) }, true)
  }

  const mutatePart = (kind: 'dup' | 'up' | 'down' | 'del') => {
    if (!sel.html || !api.subSelection || api.subSelection.elId !== sel.id) return
    const idx = api.subSelection.index
    const parsed = new DOMParser().parseFromString(sel.html, 'text/html')
    const root = parsed.body.firstElementChild
    if (!root) return
    const node = root.children[idx]
    if (!node) return
    if (kind === 'dup') root.insertBefore(node.cloneNode(true), node.nextSibling)
    if (kind === 'del') node.remove()
    if (kind === 'up') {
      const prev = root.children[idx - 1]
      if (prev) root.insertBefore(node, prev)
    }
    if (kind === 'down') {
      const next = root.children[idx + 1]
      if (next) root.insertBefore(next, node)
    }
    api.updateEl(sel.id, { html: root.outerHTML, sub: undefined }, true)
    api.setSubSelection(null)
  }

  const updatePartText = (text: string) => {
    if (!sel.html || !api.subSelection || api.subSelection.elId !== sel.id) return
    const parsed = new DOMParser().parseFromString(sel.html, 'text/html')
    const root = parsed.body.firstElementChild
    const node = root?.children[api.subSelection.index]
    if (!root || !node) return
    node.textContent = text
    api.updateEl(sel.id, { html: root.outerHTML }, false)
  }

  return (
    <div className="ed-inspector" style={{ width: panel.width }}>
      <div
        className="ed-insp-resize"
        title="拖动调整面板宽度"
        onPointerDown={panel.onPointerDown}
        onPointerMove={panel.onPointerMove}
        onPointerUp={panel.onPointerUp}
      />
      <div className="ed-panel-title ed-insp-title">
        组件属性 · {componentName(sel)}
        {sel.locked ? '（已锁定）' : ''}
      </div>
      <div className="ed-insp-body">
        {furniture && (
          <div className="ed-insp-note">
            页眉 / 报头 / 页脚是页面固定件：<strong>不能拖动</strong>（避免误碰把整页内容挤走），但可以选中改字体/字号/线宽，或直接<strong>双击改文字</strong>。改动会同步到所有页（页脚页码仍按页更新）。
          </div>
        )}
        <div className="ed-insp-grid">
          <NumField label="X" value={sel.x} onChange={(v) => setRect({ x: v })} disabled={sel.locked} />
          <NumField label="Y" value={sel.y} onChange={(v) => setRect({ y: v })} disabled={sel.locked} />
          <NumField label="宽" value={sel.w} onChange={(v) => setRect({ w: Math.max(8, v) })} disabled={sel.locked} />
          <NumField label="高" value={sel.h} onChange={(v) => setRect({ h: Math.max(8, v) })} disabled={sel.locked} />
        </div>

        {multiIds.length > 1 && (
          <div className="ed-insp-multi">
            <b>已选 {multiIds.length} 块</b>
            <span>字体/字号/颜色/行距等外观改动会写到全部 {multiIds.length} 块；位置尺寸仍只改实线框这块</span>
            <button onClick={() => api.setSelection(sel.id)}>只留当前这块</button>
          </div>
        )}

        {/* 大块拆小块 / 多块合并：画布右键也有同样入口 */}
        <Row label="拆分">
          <select
            value=""
            onChange={(e) => {
              const v = e.target.value
              if (!v) return
              if (v === 'nodes') api.splitElement(sel.id, 'nodes')
              else if (v === 'chars') api.splitElement(sel.id, 'chars', { chunkChars: 420 })
              else if (v === 'at') api.splitElement(sel.id, 'at')
              else if (v.startsWith('count')) api.splitElement(sel.id, 'count', { parts: Number(v.slice(5)) })
            }}
          >
            <option value="">选择拆分方式…</option>
            <option value="nodes" disabled={partCount < 2}>
              按段落拆成多块（{partCount} 段）
            </option>
            <option value="count2" disabled={partCount < 2}>
              均分成 2 块
            </option>
            <option value="count3" disabled={partCount < 3}>
              均分成 3 块
            </option>
            <option value="count4" disabled={partCount < 4}>
              均分成 4 块
            </option>
            <option value="chars" disabled={partCount < 2}>
              按约 420 字均分
            </option>
            <option value="at" disabled={partCount < 2 || api.subSelection?.elId !== sel.id}>
              从选中的内部元素处切开
            </option>
          </select>
        </Row>
        <Row label="合并">
          {multiIds.length > 1 ? (
            <button
              className="is-on"
              onClick={() => {
                const r = api.mergeElements(multiIds)
                if (r.skipped) {
                  popNotice({
                    tone: 'warn',
                    title: `已合并 ${r.ok} 块，跳过 ${r.skipped} 块`,
                    notes: ['不同类型（组件样式不同）的块不能拼在一起，已原样保留'],
                    hint: '先把它们的组件样式改成一致再合并',
                  })
                }
              }}
            >
              合并所选 {multiIds.length} 块
            </button>
          ) : (
            <button onClick={() => api.mergeWithNext(sel.id)}>与下一块合并</button>
          )}
          <span className="ed-hint">{multiIds.length > 1 ? '按阅读顺序拼进第一块' : 'Cmd/Ctrl 点选多块可一次合并'}</span>
        </Row>

        <Group
          id="structure"
          title="结构"
          defaultOpen={false}
          hint="内部元素 / 链 / 列表 / 表格 / 图层"
          expandWhen={!!tableModel || !!listModel || !!chainModel || subParts.length >= 2}
        >
        {subParts.length >= 2 && sel.variant !== 'ulist' && sel.variant !== 'olist' && sel.variant !== 'chain' && (
          <>
            <div className="ed-panel-title">内部元素</div>
            <div className="ed-sub-list">
              {subParts.map((p) => (
                <button
                  key={p.index}
                  className={api.subSelection?.elId === sel.id && api.subSelection.index === p.index ? 'is-on' : ''}
                  onClick={() => api.setSubSelection({ elId: sel.id, index: p.index })}
                  title={p.text}
                >
                  {p.text.slice(0, 18)}
                </button>
              ))}
            </div>
            {api.subSelection?.elId === sel.id
              ? (() => {
                  const idx = api.subSelection.index
                  const sub = sel.sub?.[String(idx)] ?? {}
                  return (
                    <div className="ed-sub-controls">
                      <label className="ed-field">
                        <span>文字内容</span>
                        <input
                          value={subParts.find((p) => p.index === idx)?.text ?? ''}
                          onFocus={api.beginTx}
                          onChange={(e) => updatePartText(e.target.value)}
                          onBlur={api.endTx}
                        />
                      </label>
                      <div className="ed-insp-row">
                        <span>结构</span>
                        <button onClick={() => mutatePart('dup')}>复制</button>
                        <button onClick={() => mutatePart('up')}>上移</button>
                        <button onClick={() => mutatePart('down')}>下移</button>
                        <button onClick={() => mutatePart('del')}>删除</button>
                      </div>
                      <SelectField
                        label="字体"
                        value={sub.fontFamily ?? ''}
                        options={FONT_FAMILIES}
                        onChange={(v) => api.updateSubStyle(sel.id, idx, { fontFamily: v })}
                      />
                      <SelectField
                        label="字号"
                        value={sub.fontSize ? parseFloat(sub.fontSize) : ''}
                        options={FONT_SIZES.map((n) => ({ value: n, label: String(n) }))}
                        onChange={(v) => api.updateSubStyle(sel.id, idx, { fontSize: v ? `${v}px` : '' })}
                      />
                      <SelectField
                        label="字重"
                        value={sub.fontWeight ?? ''}
                        options={['400', '500', '600', '700', '800'].map((w) => ({ value: w, label: w }))}
                        onChange={(v) => api.updateSubStyle(sel.id, idx, { fontWeight: v })}
                      />
                      <ColorField
                        label="字色"
                        value={sub.color}
                        onChange={(c) => api.updateSubStyle(sel.id, idx, { color: c })}
                        onClear={() => api.updateSubStyle(sel.id, idx, { color: undefined })}
                      />
                      <div className="ed-insp-row">
                        <span>偏移</span>
                        <label className="ed-sub-offset">
                          X
                          <input
                            type="number"
                            value={Math.round(sub.dx ?? 0)}
                            onChange={(e) => api.updateSubStyle(sel.id, idx, { dx: parseFloat(e.target.value) || 0 })}
                          />
                        </label>
                        <label className="ed-sub-offset">
                          Y
                          <input
                            type="number"
                            value={Math.round(sub.dy ?? 0)}
                            onChange={(e) => api.updateSubStyle(sel.id, idx, { dy: parseFloat(e.target.value) || 0 })}
                          />
                        </label>
                        <button onClick={() => api.updateSubStyle(sel.id, idx, { dx: 0, dy: 0 })}>归零</button>
                      </div>
                      <div className="ed-insp-row">
                        <button className={sub.italic ? 'is-on' : ''} onClick={() => api.updateSubStyle(sel.id, idx, { italic: !sub.italic })}>
                          I
                        </button>
                        <button className={sub.underline ? 'is-on' : ''} onClick={() => api.updateSubStyle(sel.id, idx, { underline: !sub.underline })}>
                          U
                        </button>
                        <button onClick={() => api.clearSubStyle(sel.id, idx)}>重置此内部元素</button>
                      </div>
                      <div className="ed-insp-note">
                        内部元素可单独改字体/字号/颜色/对齐；选中后方向键 1px 微调，Shift + 方向键 10px。双击整个组件仍可改文字内容。
                      </div>
                    </div>
                  )
                })()
              : (
                <div className="ed-insp-note">点一个内部元素，或直接在画布上再点它，即可单独调整字体和位置。</div>
              )}
          </>
        )}

        {chainModel && (
          <>
            <div className="ed-panel-title">逻辑链节点</div>
            <div className="ed-chain-items">
              {chainModel.nodes.map((node, i) => (
                <div className="ed-chain-item" key={i}>
                  <span className="ed-chain-index">{i + 1}</span>
                  <input
                    value={node}
                    placeholder={i === 0 ? '起点' : i === chainModel.nodes.length - 1 ? '结果' : '过程'}
                    onFocus={api.beginTx}
                    onChange={(e) => {
                      const nodes = chainModel.nodes.map((n, ni) => (ni === i ? e.target.value : n))
                      api.updateEl(sel.id, { html: buildChain({ nodes }) }, false)
                    }}
                    onBlur={api.endTx}
                  />
                  <button
                    className="ed-list-remove"
                    disabled={chainModel.nodes.length <= 1}
                    onClick={() => api.updateEl(sel.id, { html: buildChain({ nodes: chainModel.nodes.filter((_, ni) => ni !== i) }) }, true)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="ed-insp-row">
              <button onClick={() => api.updateEl(sel.id, { html: buildChain({ nodes: [...chainModel.nodes, ''] }) }, true)}>＋ 节点</button>
            </div>
            <div className="ed-insp-note">
              节点之间会自动生成 →。一个节点时保留节点，添加第二个节点后自动出现箭头。
            </div>
          </>
        )}

        {listModel && (
          <>
            <div className="ed-panel-title">列表模板</div>
            <div className="ed-list-type">
              <button
                className={listModel.type === 'ul' ? 'is-on' : ''}
                onClick={() => {
                  const next = switchListType(listModel, 'ul')
                  api.updateEl(sel.id, { html: buildList(next), variant: 'ulist', autoHeight: true }, true)
                }}
              >
                无序列表
              </button>
              <button
                className={listModel.type === 'ol' ? 'is-on' : ''}
                onClick={() => {
                  const next = switchListType(listModel, 'ol')
                  api.updateEl(sel.id, { html: buildList(next), variant: 'olist', autoHeight: true }, true)
                }}
              >
                有序列表
              </button>
            </div>
            <div className="ed-list-templates">
              {(listModel.type === 'ul' ? UL_TEMPLATES : OL_TEMPLATES).map((t) => (
                <button
                  key={t.value}
                  className={listModel.style === t.value ? 'is-on' : ''}
                  onClick={() => api.updateEl(sel.id, { html: buildList({ ...listModel, style: t.value }), autoHeight: true }, true)}
                >
                  <span className={`ed-list-dot is-${t.value}`} />
                  {t.label}
                </button>
              ))}
            </div>
            <div className="ed-list-items">
              {listModel.items.map((item, i) => (
                <div className="ed-list-item" key={i}>
                  <span className="ed-list-marker">{i + 1}</span>
                  <input
                    value={item}
                    onFocus={api.beginTx}
                    onChange={(e) => {
                      const items = listModel.items.map((x, xi) => (xi === i ? e.target.value : x))
                      api.updateEl(sel.id, { html: buildList({ ...listModel, items }), autoHeight: true }, false)
                    }}
                    onBlur={api.endTx}
                  />
                  <button
                    className="ed-list-remove"
                    disabled={listModel.items.length <= 1}
                    onClick={() => api.updateEl(sel.id, { html: buildList({ ...listModel, items: listModel.items.filter((_, xi) => xi !== i) }), autoHeight: true }, true)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="ed-insp-row">
              <button onClick={() => api.updateEl(sel.id, { html: buildList({ ...listModel, items: [...listModel.items, ''] }), autoHeight: true }, true)}>＋ 列表项</button>
            </div>
            <div className="ed-insp-note">模板实时切换；列表项可直接增删改，列表高度随内容自动调整。</div>
          </>
        )}

        {tableModel && (
          <>
            <div className="ed-panel-title">表格结构</div>
            <div className="ed-table-tools">
              <span>
                {tableModel.rows.length} 行 × {tableModel.headers.length} 列
              </span>
              <button onClick={() => api.updateEl(sel.id, { html: buildTable(resizeRows(tableModel, -1)) }, true)} disabled={tableModel.rows.length <= 1}>
                − 行
              </button>
              <button onClick={addTableRow}>＋ 行</button>
              <button onClick={() => api.updateEl(sel.id, { html: buildTable(resizeCols(tableModel, -1)) }, true)} disabled={tableModel.headers.length <= 1}>
                − 列
              </button>
              <button onClick={() => api.updateEl(sel.id, { html: buildTable(resizeCols(tableModel, 1)) }, true)}>＋ 列</button>
            </div>
            <div className="ed-insp-row">
              <button onClick={clearTable}>清空表格内容</button>
            </div>
            <div className="ed-table-editor" style={{ gridTemplateColumns: `repeat(${tableModel.headers.length}, minmax(58px, 1fr))` }}>
              {tableModel.headers.map((h, ci) => (
                <input
                  key={`h-${ci}`}
                  className="is-head"
                  value={h}
                  title={h}
                  placeholder={`表头 ${ci + 1}`}
                  onFocus={api.beginTx}
                  onChange={(e) => api.updateEl(sel.id, { html: buildTable(setHeader(tableModel, ci, e.target.value)) }, false)}
                  onBlur={api.endTx}
                />
              ))}
              {tableModel.rows.map((row, ri) =>
                row.map((cell, ci) => (
                  <input
                    key={`${ri}-${ci}`}
                    value={cell}
                    title={cell}
                    placeholder="单元格"
                    onFocus={api.beginTx}
                    onChange={(e) => api.updateEl(sel.id, { html: buildTable(setCell(tableModel, ri, ci, e.target.value)) }, false)}
                    onBlur={api.endTx}
                  />
                )),
              )}
            </div>
            <div className="ed-insp-note">直接改表头和单元格；＋行 / ＋列会同步扩展表格，行高随内容自动调整。</div>
          </>
        )}

        <div className="ed-insp-row">
          <button
            className={sel.background ? 'is-on' : ''}
            data-tip="<b>背景层</b>标记为背景层后允许其他内容覆盖；背景颜色请用下方「底色」"
            onClick={() => api.updateEl(sel.id, { background: !sel.background })}
          >
            背景层
          </button>
          {sel.kind !== 'image' && sel.kind !== 'region' && sel.kind !== 'line' && (
            <button
              className={sel.autoHeight !== false ? 'is-on' : ''}
              data-tip="<b>文字自动高度</b>开启后高度由内容决定，文字变多时自动长高并下推后续组件"
              onClick={() => api.updateEl(sel.id, { autoHeight: sel.autoHeight === false })}
            >
              自动高度
            </button>
          )}
        </div>

        <div className="ed-insp-row">
          <button
            disabled={sel.locked || selPageIdx <= 0}
            onClick={() => api.moveElToPage(sel.id, selPageIdx - 1)}
            data-tip="<b>移到上一页</b>把当前组件整体搬到上一页顶部"
          >
            ← 上一页
          </button>
          <button
            disabled={sel.locked}
            onClick={() => api.moveElToNextPage(sel.id)}
            data-tip="<b>移到下一页</b>把当前组件整体搬到下一页顶部，后续内容自动下推"
          >
            下一页 →
          </button>
        </div>
        <div className="ed-insp-row">
          <span>移到</span>
          <select value={targetPage} onChange={(e) => setTargetPage(parseInt(e.target.value, 10))}>
            {api.doc.pages.map((p, i) => (
              <option key={p.id} value={i}>
                第 {i + 1} 页
              </option>
            ))}
          </select>
          <button
            disabled={sel.locked || targetPage === selPageIdx}
            onClick={() => api.moveElToPageAt(sel.id, targetPage, sel.x, sel.y)}
            data-tip="<b>移到指定页</b>按当前位置搬到目标页，原页自动补空、目标页自动下推"
          >
            移动
          </button>
        </div>
        </Group>

        <Group
          id="media"
          title="图片 / 二维码 / 区域"
          defaultOpen={false}
          expandWhen={sel.kind === 'image' || sel.kind === 'region' || sel.variant === 'qr'}
        >
        {sel.kind === 'image' && (
          <>
            <label className="ed-field">
              <span>图片地址</span>
              <input
                value={sel.src ?? ''}
                placeholder="https://… / /images/img1.png / file:///Users/…/img1.png"
                onFocus={api.beginTx}
                onChange={(e) => api.updateEl(sel.id, { src: e.target.value }, false)}
                onBlur={api.endTx}
              />
            </label>
            <div className="ed-insp-row">
              <button onClick={() => imgRef.current?.click()}>选择本地图片</button>
              <button onClick={() => api.makeBackground(sel.id)} data-tip="<b>全屏背景</b>把当前图片铺满本页并置于最底层">
                设为全屏背景
              </button>
              {sel.background && sel.src && (
                <button onClick={() => api.setPageBackground(sel.src ?? '')} data-tip="<b>应用到所有页</b>让每一页都使用这张全屏背景">
                  应用到所有页
                </button>
              )}
            </div>
            <input
              ref={imgRef}
              type="file"
              accept="image/*"
              className="ed-hidden-input"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                // 降采样再入档：直接 base64 原图会把 localStorage 配额吃光
                fileToCompactDataURL(f).then((src) => api.updateEl(sel.id, { src }))
                e.target.value = ''
              }}
            />
            <div className="ed-insp-note">
              支持网络图片、public 目录（/images/…）与本地图片：可直接填 <code>file:///Users/…/img1.png</code>；
              「选择本地图片」把图片内嵌进文档（导出 JSON 一并保存）。
              大图会自动压缩到最长边 1600px 再存，防止存档撑爆。
            </div>
          </>
        )}

        {sel.variant === 'qr' && (
          <>
            <div className="ed-panel-title">二维码</div>
            <label className="ed-field">
              <span>二维码图片</span>
              <input
                value={sel.src ?? ''}
                placeholder="二维码图片地址 / file:///… / data:image…"
                onFocus={api.beginTx}
                onChange={(e) => api.updateEl(sel.id, { src: e.target.value }, false)}
                onBlur={api.endTx}
              />
            </label>
            <div className="ed-insp-row">
              <button onClick={() => qrRef.current?.click()}>选择二维码图片</button>
              {sel.src && (
                <button onClick={() => api.updateEl(sel.id, { src: '' })} data-tip="<b>清除二维码</b>恢复占位图案">
                  清除二维码
                </button>
              )}
            </div>
            <input
              ref={qrRef}
              type="file"
              accept="image/*"
              className="ed-hidden-input"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (!f) return
                fileToCompactDataURL(f, { maxEdge: 800, quality: 0.9 }).then((src) => api.updateEl(sel.id, { src }))
                e.target.value = ''
              }}
            />
            <div className="ed-insp-note">
              左侧二维码会换成你的图片；右侧「扫码关注…」文字可双击组件直接修改。
              「选择二维码图片」会把图片内嵌进文档，导出 JSON 一并保存。
            </div>
          </>
        )}

        {sel.kind === 'region' && (
          <label className="ed-field">
            <span>区域名称</span>
            <input
              value={sel.label ?? ''}
              onFocus={api.beginTx}
              onChange={(e) => api.updateEl(sel.id, { label: e.target.value }, false)}
              onBlur={api.endTx}
            />
          </label>
        )}
        </Group>

        <Group id="text" title="文字">
        {(sel.kind === 'text' || sel.kind === 'box' || sel.kind === 'chrome') && (
          <>
            <FieldGrid cols={4}>
              <SelectField
                compact
                label="字体"
                value={style.fontFamily ?? ''}
                options={FONT_FAMILIES}
                onChange={(v) => setStyle({ fontFamily: v })}
              />
              <SelectField
                compact
                label="字号"
                value={style.fontSize ? parseFloat(style.fontSize) : ''}
                options={FONT_SIZES.map((n) => ({ value: n, label: String(n) }))}
                onChange={(v) => setStyle({ fontSize: v ? `${v}px` : '' })}
              />
              <ColorField
                compact
                label="字色"
                value={style.color}
                onChange={(c) => setStyle({ color: c })}
                onClear={() => setStyle({ color: undefined })}
              />
              <ColorField
                compact
                label="底色"
                value={style.background}
                allowTransparent
                onChange={(c) => setStyle({ background: c })}
                onClear={() => setStyle({ background: undefined })}
              />
            </FieldGrid>
            <div className="ed-insp-note" style={{ marginTop: 0, marginBottom: 8 }}>
              底色 = 组件背景色，会作用到提示框、表格、页脚等内容表面，而不是只改外层选区。
            </div>
            <FieldGrid cols={2}>
              <SelectField
                compact
                label="行距"
                value={style.lineHeight ?? ''}
                options={LINE_HEIGHTS.map((n) => ({ value: n, label: String(n) }))}
                onChange={(v) => setStyle({ lineHeight: v })}
              />
              <SelectField
                compact
                label="字距"
                value={style.letterSpacing ?? ''}
                options={LETTER_SPACINGS}
                onChange={(v) => setStyle({ letterSpacing: v })}
              />
            </FieldGrid>
          </>
        )}
        </Group>

        {sel.html !== undefined && (
          <div className="ed-insp-row">
            <button
              type="button"
              onClick={() => {
                setHtmlBase(sel.html ?? '')
                // 整个编辑过程算一次操作，撤销一步就回去
                api.beginTx()
                setHtmlOpen(true)
              }}
            >
              编辑 HTML（分屏预览）
            </button>
            <span className="ed-hint">表格、时间线等没有专用编辑器的组件用这里改</span>
          </div>
        )}

        <Group id="look" title="外观 / 层级">
        {sel.kind !== 'image' && (
          sel.kind === 'line' ? (
            <SelectField
              label="线宽"
              hint="px"
              value={LINE_WIDTHS.includes(Math.round(sel.h)) ? Math.round(sel.h) : ''}
              options={LINE_WIDTHS.map((v) => ({ value: v, label: String(v) }))}
              onChange={(v) => setRect({ h: Number(v) })}
            />
          ) : (
            <>
              <SelectField
                label="线宽"
                hint="px"
                value={style.lineWidth ?? ''}
                options={LINE_WIDTHS.map((v) => ({ value: `${v}px`, label: String(v) }))}
                onChange={(v) => setStyle({ lineWidth: v })}
              />
              <div className="ed-insp-note" style={{ marginTop: 0, marginBottom: 8 }}>
                线宽作用于该组件自带的边框/分隔线：页眉下划线、报头装饰线、章节下划线、页脚上边框、表格、提示框、分隔线等；没有线时无效。
              </div>
            </>
          )
        )}
        <label className="ed-field">
          <span>透明度 {style.opacity ?? 1}</span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={style.opacity ?? 1}
            onChange={(e) => setStyle({ opacity: parseFloat(e.target.value) })}
          />
        </label>
        <NumField label="旋转" value={style.rotate ?? 0} onChange={(v) => setStyle({ rotate: v })} />

        {/* 对齐到版心：单选时最常用的六个方位 */}
        <div className="ed-insp-row ed-align-row">
          {(
            [
              ['left', '左', '左对齐到版心'],
              ['cx', '中', '水平居中于版心'],
              ['right', '右', '右对齐到版心'],
              ['top', '顶', '顶对齐到版心'],
              ['cy', '中', '垂直居中于版心'],
              ['bottom', '底', '底对齐到版心'],
            ] as Array<['left' | 'cx' | 'right' | 'top' | 'cy' | 'bottom', string, string]>
          ).map(([k, label, tip]) => (
            <button
              key={k}
              data-tip={`<b>对齐</b>${tip}`}
              onClick={() => {
                const doc = api.doc
                const geo = getGeometry(doc, (selPageIdx < 0 ? api.pageIdx : selPageIdx) || 0)
                const left = geo.left
                const right = geo.right
                const top = geo.top
                const bottom = geo.bottom
                if (k === 'left') api.updateEl(sel.id, { x: left })
                else if (k === 'cx') api.updateEl(sel.id, { x: left + (right - left - sel.w) / 2 })
                else if (k === 'right') api.updateEl(sel.id, { x: right - sel.w })
                else if (k === 'top') api.updateEl(sel.id, { y: top })
                else if (k === 'cy') api.updateEl(sel.id, { y: top + (bottom - top - sel.h) / 2 })
                else api.updateEl(sel.id, { y: bottom - sel.h })
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ed-insp-note" style={{ marginTop: 0 }}>
          对齐是相对版心（左右 12mm / 上下按 A4 版心）的；被锁定或属于页眉/页脚的组件在属性区禁用移动。
        </div>

        <div className="ed-insp-row">
          <button onClick={() => api.setZ(sel.id, 'front')}>置顶</button>
          <button onClick={() => api.setZ(sel.id, 'up')}>上移</button>
          <button onClick={() => api.setZ(sel.id, 'down')}>下移</button>
          <button onClick={() => api.setZ(sel.id, 'back')}>置底</button>
        </div>
        <div className="ed-insp-row">
          <button className={sel.locked ? 'is-on' : ''} onClick={() => api.toggleLock(sel.id)}>
            {sel.locked ? '解锁' : '锁定'}
          </button>
          <button onClick={() => api.duplicateEl(sel.id)}>复制</button>
          <button className="is-danger" onClick={() => api.removeEl(sel.id)}>
            删除
          </button>
        </div>

        <div className="ed-insp-note">
          所在区域约束：{region ? `「${region.label || region.id}」（拖动不会超出该区域）` : '无（自由移动）'}
          <br />
          页码：第 {(selPageIdx < 0 ? api.pageIdx : selPageIdx) + 1} 页 · z 层级：{Math.round(sel.z)}
          <br />
          方向键 = 与上下左右相邻的组件交换位置；Alt + 方向键 = 微调 1px（再按 Shift 变 10px），微调不会触发自动补齐。
        </div>
        </Group>
      </div>

      <HtmlDrawer
        open={htmlOpen && sel.html !== undefined}
        title={componentName(sel)}
        value={htmlBase}
        // 停止输入后写回画布：不记历史（事务里），画布上能立刻看到效果
        onPreview={(html) => api.updateEl(sel.id, { html }, false)}
        // 应用：把这段编辑合并成一步撤销
        onApply={(html) => {
          api.updateEl(sel.id, { html }, false)
          api.endTx()
          setHtmlOpen(false)
        }}
        // 取消：内容还原成打开时的样子，再结束事务
        onCancel={() => {
          api.updateEl(sel.id, { html: htmlBase }, false)
          api.endTx()
          setHtmlOpen(false)
        }}
      />
    </div>
  )
}
