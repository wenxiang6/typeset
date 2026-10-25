import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditorApi } from './store'
import { findRegion, isFurniture, resolveMove } from './layout'
import { componentName } from './componentNames'
import { FONT_FAMILIES, FONT_SIZES, LETTER_SPACINGS, LINE_HEIGHTS, PRESET_COLORS } from './format'
import { buildTable, parseTable, resizeCols, resizeRows, setCell, setHeader } from './table'
import { buildList, parseList, switchListType, OL_TEMPLATES, UL_TEMPLATES } from './list'
import { buildChain, parseChain } from './chain'

const LINE_WIDTHS = [1, 2, 3, 4, 6, 8]

function toHex(c?: string): string {
  if (!c || c === 'transparent') return '#ffffff'
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('')
  const m = c.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
  if (m) return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')
  return '#ffffff'
}

function Num({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="ed-num">
      <span>{label}</span>
      <input type="number" value={Math.round(value * 10) / 10} step={step} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
    </label>
  )
}

export function Inspector({ api }: { api: EditorApi }) {
  const sel = api.selection ? api.findEl(api.selection) : null
  const [htmlDraft, setHtmlDraft] = useState<string | null>(null)
  useEffect(() => setHtmlDraft(null), [api.selection])
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
      <div className="ed-inspector">
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
              onClick={() => {
                if (!confirm(`删除第 ${api.pageIdx + 1} 页？该页内容会一并删除。`)) return
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
              onClick={() => {
                if (confirm('重建分页会按阅读顺序重新排版全部内容（区域辅助框会丢弃），继续？')) api.repair()
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
          <Num label="字号" value={api.doc.watermark.size} onChange={(v) => api.updatePage({ watermark: { ...api.doc.watermark, size: v } })} />
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
          <Num label="角度" value={api.doc.watermark.angle} onChange={(v) => api.updatePage({ watermark: { ...api.doc.watermark, angle: v } })} />

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
    <div className="ed-inspector">
      <div className="ed-panel-title ed-insp-title">
        组件属性 · {componentName(sel)}
        {sel.locked ? '（已锁定）' : ''}
      </div>
      <div className="ed-insp-body">
        {furniture && (
          <div className="ed-insp-note">
            页眉 / 报头 / 页脚是页面固定件：移动范围限定在页边区域，不会改变正文版心，也不会把整页内容挤走。修改页眉/页脚的内容、字体、线宽、尺寸会同步到所有页（页脚页码仍按页更新）。
          </div>
        )}
        <div className="ed-insp-grid">
          <Num label="X" value={sel.x} onChange={(v) => setRect({ x: v })} />
          <Num label="Y" value={sel.y} onChange={(v) => setRect({ y: v })} />
          <Num label="宽" value={sel.w} onChange={(v) => setRect({ w: Math.max(8, v) })} />
          <Num label="高" value={sel.h} onChange={(v) => setRect({ h: Math.max(8, v) })} />
        </div>

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
                      <label className="ed-field">
                        <span>字体</span>
                        <select value={sub.fontFamily ?? ''} onChange={(e) => api.updateSubStyle(sel.id, idx, { fontFamily: e.target.value })}>
                          <option value="">默认</option>
                          {FONT_FAMILIES.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="ed-field">
                        <span>字号</span>
                        <select
                          value={sub.fontSize ? parseFloat(sub.fontSize) : ''}
                          onChange={(e) => api.updateSubStyle(sel.id, idx, { fontSize: e.target.value ? `${e.target.value}px` : '' })}
                        >
                          <option value="">默认</option>
                          {FONT_SIZES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="ed-field">
                        <span>字重</span>
                        <select value={sub.fontWeight ?? ''} onChange={(e) => api.updateSubStyle(sel.id, idx, { fontWeight: e.target.value })}>
                          <option value="">默认</option>
                          {['400', '500', '600', '700', '800'].map((w) => (
                            <option key={w} value={w}>
                              {w}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="ed-field">
                        <span>字色</span>
                        <div className="ed-colors">
                          {PRESET_COLORS.map((c) => (
                            <i
                              key={c}
                              className={sub.color === c ? 'is-on' : ''}
                              style={{ background: c }}
                              title={c}
                              onClick={() => api.updateSubStyle(sel.id, idx, { color: c })}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="ed-insp-row">
                        <span>对齐</span>
                        {(['left', 'center', 'right', 'justify'] as const).map((a) => (
                          <button key={a} className={sub.align === a ? 'is-on' : ''} onClick={() => api.updateSubStyle(sel.id, idx, { align: a })}>
                            {a === 'left' ? '左' : a === 'center' ? '中' : a === 'right' ? '右' : '两端'}
                          </button>
                        ))}
                      </div>
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
            disabled={selPageIdx <= 0}
            onClick={() => api.moveElToPage(sel.id, selPageIdx - 1)}
            data-tip="<b>移到上一页</b>把当前组件整体搬到上一页顶部"
          >
            ← 上一页
          </button>
          <button
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
            disabled={targetPage === selPageIdx}
            onClick={() => api.moveElToPageAt(sel.id, targetPage, sel.x, sel.y)}
            data-tip="<b>移到指定页</b>按当前位置搬到目标页，原页自动补空、目标页自动下推"
          >
            移动
          </button>
        </div>

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
                const reader = new FileReader()
                reader.onload = () => api.updateEl(sel.id, { src: String(reader.result) })
                reader.readAsDataURL(f)
                e.target.value = ''
              }}
            />
            <div className="ed-insp-note">
              支持网络图片、public 目录（/images/…）与本地图片：可直接填 <code>file:///Users/…/img1.png</code>；
              「选择本地图片」把图片内嵌进文档（导出 JSON 一并保存）。
              单文件版（file://）可直接读本机路径；通过 http 打开时本地路径会走开发服务器 /@local 代理。
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
                const reader = new FileReader()
                reader.onload = () => api.updateEl(sel.id, { src: String(reader.result) })
                reader.readAsDataURL(f)
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

        {(sel.kind === 'text' || sel.kind === 'box' || sel.kind === 'chrome') && (
          <>
            <div className="ed-panel-title">文字</div>
            <label className="ed-field">
              <span>字体</span>
              <select value={style.fontFamily ?? ''} onChange={(e) => api.updateStyle(sel.id, { fontFamily: e.target.value })}>
                <option value="">默认</option>
                {FONT_FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="ed-field">
              <span>字号</span>
              <select value={style.fontSize ? parseFloat(style.fontSize) : ''} onChange={(e) => api.updateStyle(sel.id, { fontSize: `${e.target.value}px` })}>
                <option value="">默认</option>
                {FONT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="ed-field">
              <span>字色</span>
              <div className="ed-colors">
                {PRESET_COLORS.map((c) => (
                  <i key={c} style={{ background: c }} onClick={() => api.updateStyle(sel.id, { color: c })} />
                ))}
              </div>
            </label>
            <label className="ed-field">
              <span>底色</span>
              <div className="ed-colors">
                <i
                  className={style.background === 'transparent' ? 'is-on' : ''}
                  style={{ background: 'transparent', border: '1px solid #ccc' }}
                  title="透明"
                  onClick={() => api.updateStyle(sel.id, { background: 'transparent' })}
                />
                {PRESET_COLORS.map((c) => (
                  <i
                    key={c}
                    className={style.background === c ? 'is-on' : ''}
                    style={{ background: c }}
                    title={c}
                    onClick={() => api.updateStyle(sel.id, { background: c })}
                  />
                ))}
                <span className="ed-color-pick" title="自定义底色">
                  <input
                    type="color"
                    value={toHex(style.background)}
                    onChange={(e) => api.updateStyle(sel.id, { background: e.target.value })}
                  />
                  <span>自定义</span>
                </span>
              </div>
            </label>
            <div className="ed-insp-note" style={{ marginTop: 0, marginBottom: 8 }}>
              底色 = 组件背景色，会作用到提示框、表格、页脚等内容表面，而不是只改外层选区。
            </div>
            <label className="ed-field">
              <span>行距</span>
              <select value={style.lineHeight ?? ''} onChange={(e) => api.updateStyle(sel.id, { lineHeight: e.target.value })}>
                <option value="">默认</option>
                {LINE_HEIGHTS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="ed-field">
              <span>字距</span>
              <select value={style.letterSpacing ?? ''} onChange={(e) => api.updateStyle(sel.id, { letterSpacing: e.target.value })}>
                <option value="">默认</option>
                {LETTER_SPACINGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="ed-insp-row">
              <span>对齐</span>
              {(['left', 'center', 'right', 'justify'] as const).map((a) => (
                <button key={a} className={(style.align ?? 'left') === a ? 'is-on' : ''} onClick={() => api.updateStyle(sel.id, { align: a })}>
                  {{ left: '左', center: '中', right: '右', justify: '两端' }[a]}
                </button>
              ))}
            </div>
          </>
        )}

        {sel.html !== undefined && (
          <details className="ed-html-editor">
            <summary>HTML 源码 / 高级结构编辑</summary>
            <textarea
              rows={7}
              value={htmlDraft ?? sel.html ?? ''}
              onChange={(e) => setHtmlDraft(e.target.value)}
              spellCheck={false}
            />
            <div className="ed-insp-row">
              <button
                disabled={htmlDraft === null}
                onClick={() => {
                  if (htmlDraft === null) return
                  api.updateEl(sel.id, { html: htmlDraft }, true)
                  setHtmlDraft(null)
                }}
              >
                应用 HTML
              </button>
              <button disabled={htmlDraft === null} onClick={() => setHtmlDraft(null)}>
                还原
              </button>
            </div>
            <div className="ed-insp-note">会直接替换组件内部结构；表格、时间线等没有专用编辑器的组件可用这里改。</div>
          </details>
        )}

        <div className="ed-panel-title">外观 / 层级</div>
        {sel.kind !== 'image' && (
          sel.kind === 'line' ? (
            <div className="ed-insp-row">
              <span>线宽</span>
              {LINE_WIDTHS.map((v) => (
                <button key={v} className={Math.round(sel.h) === v ? 'is-on' : ''} onClick={() => setRect({ h: v })}>
                  {v}
                </button>
              ))}
              <span className="ed-hint">px</span>
            </div>
          ) : (
            <>
              <div className="ed-insp-row">
                <span>线宽</span>
                <button className={!style.lineWidth ? 'is-on' : ''} onClick={() => api.updateStyle(sel.id, { lineWidth: '' })}>
                  默认
                </button>
                {LINE_WIDTHS.map((v) => (
                  <button
                    key={v}
                    className={style.lineWidth === `${v}px` ? 'is-on' : ''}
                    onClick={() => api.updateStyle(sel.id, { lineWidth: `${v}px` })}
                  >
                    {v}
                  </button>
                ))}
                <span className="ed-hint">px</span>
              </div>
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
            onChange={(e) => api.updateStyle(sel.id, { opacity: parseFloat(e.target.value) })}
          />
        </label>
        <Num label="旋转" value={style.rotate ?? 0} onChange={(v) => api.updateStyle(sel.id, { rotate: v })} />
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
          方向键 1px 微调，Shift + 方向键 10px；微调不会触发自动补齐。
        </div>
      </div>
    </div>
  )
}
