import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Doc, El, ElStyle, FlowConfig, GridConfig, Orientation, SubStyle } from './types'
import { INITIAL_DOC } from './initialDoc'
import {
  A4,
  DOC_VERSION,
  applyHeights,
  PAGE_GAP,
  clone,
  columnOf,
  ensurePage,
  findRegion,
  getGeometry,
  isBrokenLayout,
  isFlowable,
  isFurniture,
  isMeasurable,
  findNeighbor,
  swapWithNeighbor,
  resolveMove,
  moveElementToPage,
  normalizeDoc,
  placeNewElement,
  reflowDoc,
  renumberPages,
  repairLayout,
  resizeDoc,
  uid,
  addPage as addPagePure,
  removePage as removePagePure,
} from './layout'

import {
  DOC_KEY,
  SNAP_INTERVAL,
  backupCorrupt,
  listSnapshots,
  pushSnapshot,
  snapshotAt,
  writeDoc as writeDocStorage,
} from './autosave'

const STORAGE_KEY = DOC_KEY
const HISTORY_LIMIT = 60

/** 正文块变体：默认黑体五号的作用范围 */
const BODY_VARIANTS = new Set(['paragraph', 'req', 'note', 'concept', 'chain', 'trap', 'tpl', 'quiz', 'name-row'])

function loadDoc(): Doc {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Doc
      if (parsed && Array.isArray(parsed.pages) && parsed.pages.length) {
        const normalized = normalizeDoc(parsed)
        // 误拖报头/页脚导致第一页被搬空：自动重建分页
        if (isBrokenLayout(normalized)) return repairLayout(normalized)
        // 旧存档（特别是被旧版避让算法推到页外的）自动修复一次
        const needsMigration = !parsed.version || parsed.version < DOC_VERSION
        return needsMigration ? reflowDoc(normalized) : normalized
      }
      // 结构不对（pages 空 / 不是对象）：先备份，别让随后的自动保存把它盖掉
      backupCorrupt(raw)
    }
  } catch (err) {
    console.warn('[paiban] 本地存档损坏，已回退到初始模板', err)
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) backupCorrupt(raw)
    } catch {
      /* 忽略 */
    }
  }
  return clone(INITIAL_DOC)
}

const PAGE_CHROME_VARIANTS = new Set(['header', 'footer'])
const CHROME_SYNC_FIELDS = ['html', 'style', 'w', 'h', 'autoHeight', 'sub', 'src', 'x', 'y', 'locked', 'background', 'label'] as const

function isPageChrome(el: El): boolean {
  return isFurniture(el) && PAGE_CHROME_VARIANTS.has(el.variant)
}

/** 页眉/页脚：把某一页的修改同步到所有页，再重算页码 */
function syncPageChrome(doc: Doc, source: El, fields: readonly string[]) {
  if (!isPageChrome(source)) return
  for (const page of doc.pages) {
    for (const el of page.els) {
      if (el.id === source.id || el.variant !== source.variant || !isPageChrome(el)) continue
      for (const key of fields) {
        if (!CHROME_SYNC_FIELDS.includes(key as (typeof CHROME_SYNC_FIELDS)[number])) continue
        const value = (source as unknown as Record<string, unknown>)[key]
        ;(el as unknown as Record<string, unknown>)[key] = value === undefined ? undefined : JSON.parse(JSON.stringify(value))
      }
    }
  }
  renumberPages(doc)
}

export function useEditor() {
  const [doc, setDocState] = useState<Doc>(loadDoc)
  const docRef = useRef(doc)
  docRef.current = doc

  const [past, setPast] = useState<Doc[]>([])
  const [future, setFuture] = useState<Doc[]>([])
  const [selection, setSelection] = useState<string | null>(null)
  const [subSelection, setSubSelectionState] = useState<{ elId: string; index: number } | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [grid, setGrid] = useState<GridConfig>({ show: true, snap: true, cell: 8 })
  const [zoom, setZoom] = useState(1)
  const [pageIdx, setPageIdxState] = useState(0)
  const [drawMode, setDrawMode] = useState(false)
  const saveTimer = useRef<number | undefined>(undefined)
  /** 最近一次序列化结果：10 秒快照和「离开页面兜底」都复用它，不重复 stringify */
  const rawRef = useRef('')
  /** 最近一次已经写进 localStorage 的内容，用来判断「还有没有没落盘的改动」 */
  const lastWrittenRef = useRef('')

  // 切换到别的组件/页面时，自动退出内部元素选择
  useEffect(() => {
    setSubSelectionState(null)
  }, [selection, pageIdx])


  /* —— 事务：拖动/缩放/连续输入合并为一次撤销 —— */
  const txSnap = useRef<Doc | null>(null)
  const txChanged = useRef(false)
  const txActive = useRef(false)

  const setDoc = useCallback((next: Doc) => {
    docRef.current = next
    setDocState(next)
  }, [])

  // 自动保存：改动 400ms 后落地（主存档），保证刷新/崩溃只丢最后 0.4 秒。
  // 注意这里不 setState：保存结果走 autosave 的订阅式小仓库，
  // 否则每保存一次就整棵树重渲染，会打断正在进行的拖动（表格行列线等）。
  useEffect(() => {
    rawRef.current = JSON.stringify(doc)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      writeDocStorage(rawRef.current)
      lastWrittenRef.current = rawRef.current
    }, 400)
    return () => window.clearTimeout(saveTimer.current)
  }, [doc])

  // 滚动快照：编辑状态下每 10 秒打一份，专治「手滑之后才想起来」
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!rawRef.current) return
      pushSnapshot(rawRef.current, docRef.current)
    }, SNAP_INTERVAL)
    return () => window.clearInterval(id)
  }, [])

  // 关窗口 / 切到后台：立刻补写还没落盘的改动。
  // 注意只补「有改动」的那一次：如果存档是被外部清掉的（清空存档、测试重置），
  // 这里不能把它又写回去，否则重置等于没做。
  useEffect(() => {
    const flush = () => {
      const raw = rawRef.current
      if (!raw || raw === lastWrittenRef.current) return
      // 存档已经被清掉了（用户主动重置 / 测试重置）：不要把内存里的版面写回去
      let hasArchive = false
      try {
        hasArchive = localStorage.getItem(DOC_KEY) !== null
      } catch {
        hasArchive = false
      }
      if (!hasArchive) return
      writeDocStorage(raw)
      lastWrittenRef.current = raw
      pushSnapshot(raw, docRef.current)
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  const commit = useCallback(
    (updater: (d: Doc) => Doc) => {
      const current = docRef.current
      const next = updater(clone(current))
      if (!next || next === current) return
      setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), clone(current)])
      setFuture([])
      setDoc(next)
    },
    [setDoc],
  )

  /** 给“无历史连续输入”补一个历史快照（在输入开始时调用） */
  const beginTx = useCallback(() => {
    txSnap.current = clone(docRef.current)
    txChanged.current = false
    txActive.current = true
  }, [])

  /** 连续操作结束：合并历史，并做一次回流/分页 */
  const endTx = useCallback(() => {
    txActive.current = false
    const snap = txSnap.current
    txSnap.current = null
    if (!snap) return
    if (!txChanged.current) {
      txChanged.current = false
      return
    }
    txChanged.current = false
    const next = reflowDoc(clone(docRef.current))
    setDoc(next)
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), snap])
    setFuture([])
  }, [setDoc])

  const cancelTx = useCallback(() => {
    txActive.current = false
    const snap = txSnap.current
    txSnap.current = null
    txChanged.current = false
    if (snap) setDoc(snap)
  }, [setDoc])

  const undo = useCallback(() => {
    if (!past.length) return
    const prev = past[past.length - 1]
    setFuture((f) => [clone(docRef.current), ...f.slice(0, HISTORY_LIMIT - 1)])
    setPast((p) => p.slice(0, -1))
    setDoc(clone(prev))
    setSelection(null)
    setEditingId(null)
  }, [past, setDoc])

  const redo = useCallback(() => {
    if (!future.length) return
    const next = future[0]
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), clone(docRef.current)])
    setFuture((f) => f.slice(1))
    setDoc(clone(next))
    setSelection(null)
    setEditingId(null)
  }, [future, setDoc])

  const findEl = useCallback(
    (id: string) => {
      for (const p of doc.pages) {
        const el = p.els.find((e) => e.id === id)
        if (el) return el
      }
      return null
    },
    [doc],
  )

  const updateEl = useCallback(
    (id: string, patch: Partial<El>, withHistory = true) => {
      const apply = (d: Doc) => {
        let source: El | null = null
        d.pages.forEach((p) => {
          p.els = p.els.map((e) => {
            if (e.id !== id) return e
            source = { ...e, ...patch }
            return source
          })
        })
        if (source) syncPageChrome(d, source, Object.keys(patch))
        return d
      }
      if (withHistory) {
        commit(apply)
      } else {
        txChanged.current = true
        setDoc(apply(clone(docRef.current)))
      }
    },
    [commit, setDoc],
  )

  const updateStyle = useCallback(
    (id: string, patch: Partial<ElStyle>) => {
      commit((d) => {
        let source: El | null = null
        d.pages.forEach((p) => {
          p.els = p.els.map((e) => {
            if (e.id !== id) return e
            source = { ...e, style: { ...e.style, ...patch } }
            return source
          })
        })
        if (source) syncPageChrome(d, source, ['style'])
        return d
      })
    },
    [commit],
  )

  /** 方向键微调：只移动 1px/10px，不做自动补齐，避免刚移动就被吸回 */
  const nudge = useCallback(
    (id: string, dx: number, dy: number) => {
      if (!dx && !dy) return
      commit((d) => {
        for (let pi = 0; pi < d.pages.length; pi++) {
          const page = d.pages[pi]
          const el = page.els.find((e) => e.id === id)
          if (!el) continue
          if (el.locked) return d
          const g = getGeometry(d, pi)
          const prev = { x: el.x, y: el.y, w: el.w, h: el.h }
          const next = { ...prev, x: prev.x + dx, y: prev.y + dy }

          if (el.kind === 'region' || el.background) {
            next.x = Math.min(Math.max(next.x, 0), Math.max(0, d.w - next.w))
            next.y = Math.min(Math.max(next.y, 0), Math.max(0, d.h - next.h))
            Object.assign(el, next)
          } else if (isFurniture(el)) {
            const res = resolveMove(d, pi, id, next, prev, null)
            Object.assign(el, res.rect)
          } else {
            const regionEl = findRegion(d, pi, prev, id)
            const region = regionEl ? { x: regionEl.x, y: regionEl.y, w: regionEl.w, h: regionEl.h } : null
            const res = resolveMove(d, pi, id, next, prev, region)
            const rect = res.rect
            rect.x = Math.min(Math.max(rect.x, g.left), Math.max(g.left, g.right - rect.w))
            rect.y = Math.min(Math.max(rect.y, g.top), Math.max(g.top, g.bottom - rect.h))
            Object.assign(el, rect)
            res.pushed.forEach((r, pid) => {
              const p = page.els.find((e) => e.id === pid)
              if (p) Object.assign(p, r)
            })
          }
          if (isPageChrome(el)) syncPageChrome(d, el, ['x', 'y'])
          break
        }
        return d
      })
    },
    [commit],
  )

  /**
   * 与指定方向上最近的相邻组件交换位置（方向键）。
   * 只交换阅读顺序、不改两者合起来占的空间，所以不会压到下面的内容。
   * @returns 是否真的发生了交换
   */
  const swapNeighbor = useCallback(
    (id: string, dir: 'up' | 'down' | 'left' | 'right') => {
      const d0 = docRef.current
      let pi = -1
      for (let i = 0; i < d0.pages.length; i++) {
        if (d0.pages[i].els.some((e) => e.id === id)) {
          pi = i
          break
        }
      }
      if (pi < 0) return false
      // 先探测：没有可交换对象就不要写历史
      if (!findNeighbor(d0, pi, id, dir)) return false
      commit((d) => {
        swapWithNeighbor(d, pi, id, dir)
        return d
      })
      return true
    },
    [commit],
  )

  /** 选择复合组件内部的一个直接子元素 */
  const setSubSelection = useCallback((next: { elId: string; index: number } | null) => {
    setSubSelectionState(next)
  }, [])

  /** 修改内部元素样式（字体/字号/颜色/对齐等），只作用于该子元素 */
  const updateSubStyle = useCallback(
    (id: string, index: number, patch: Partial<SubStyle>) => {
      commit((d) => {
        for (const page of d.pages) {
          const el = page.els.find((e) => e.id === id)
          if (!el) continue
          const key = String(index)
          const cur = el.sub?.[key] ?? {}
          el.sub = { ...(el.sub ?? {}), [key]: { ...cur, ...patch } }
          syncPageChrome(d, el, ['sub'])
          break
        }
        return d
      })
    },
    [commit],
  )

  /** 内部元素方向键微调：只改相对偏移，不重排整个组件 */
  const nudgeSub = useCallback(
    (id: string, index: number, dx: number, dy: number) => {
      if (!dx && !dy) return
      commit((d) => {
        for (const page of d.pages) {
          const el = page.els.find((e) => e.id === id)
          if (!el) continue
          const key = String(index)
          const cur = el.sub?.[key] ?? {}
          el.sub = { ...(el.sub ?? {}), [key]: { ...cur, dx: (cur.dx ?? 0) + dx, dy: (cur.dy ?? 0) + dy } }
          syncPageChrome(d, el, ['sub'])
          break
        }
        return d
      })
    },
    [commit],
  )

  const clearSubStyle = useCallback(
    (id: string, index: number) => {
      commit((d) => {
        for (const page of d.pages) {
          const el = page.els.find((e) => e.id === id)
          if (!el) continue
          if (el.sub) {
            const next = { ...el.sub }
            delete next[String(index)]
            el.sub = Object.keys(next).length ? next : undefined
            syncPageChrome(d, el, ['sub'])
          }
          break
        }
        return d
      })
    },
    [commit],
  )

  /** 把默认正文字体/字号（黑体五号）应用到全部正文块（可撤销） */
  const applyDefaultsToBody = useCallback(() => {
    commit((d) => {
      for (const page of d.pages) {
        for (const el of page.els) {
          if (el.kind === 'text' && BODY_VARIANTS.has(el.variant)) {
            el.style = { ...el.style, fontFamily: d.defaults.fontFamily, fontSize: d.defaults.fontSize }
          }
        }
      }
      return d
    })
  }, [commit])

  const addEl = useCallback(
    (page: number, el: Omit<El, 'id' | 'z'>) => {
      const id = uid('el')
      commit((d) => {
        const targetIdx = Math.max(0, page)
        ensurePage(d, targetIdx)
        const target = d.pages[targetIdx]
        // 区域是容器/约束层，永远置于最底层；其余元素置顶
        const z =
          el.kind === 'region' || el.background
            ? Math.min(0, ...target.els.map((e) => e.z)) - 1
            : Math.max(0, ...target.els.map((e) => e.z)) + 1
        const style = { ...el.style }
        if (el.kind === 'text' && BODY_VARIANTS.has(el.variant) && !style.fontFamily) {
          style.fontFamily = d.defaults.fontFamily
          if (!style.fontSize) style.fontSize = d.defaults.fontSize
        }
        const node: El = { ...el, id, z, style }
        placeNewElement(d, targetIdx, node)
        return d
      })
      setSelection(id)
      return id
    },
    [commit],
  )

  const removeEl = useCallback(
    (id: string) => {
      commit((d) => {
        d.pages.forEach((p) => {
          p.els = p.els.filter((e) => e.id !== id)
        })
        return d
      })
      setSelection((s) => (s === id ? null : s))
    },
    [commit],
  )

  const duplicateEl = useCallback(
    (id: string) => {
      const newId = uid('el')
      commit((d) => {
        for (let pageIdx = 0; pageIdx < d.pages.length; pageIdx++) {
          const p = d.pages[pageIdx]
          const src = p.els.find((e) => e.id === id)
          if (!src) continue
          const copy: El = clone(src)
          copy.id = newId
          copy.x = src.x + 16
          copy.y = src.y + 16
          copy.z = Math.max(0, ...p.els.map((e) => e.z)) + 1
          placeNewElement(d, pageIdx, copy)
          break
        }
        return d
      })
      setSelection(newId)
    },
    [commit],
  )

  const setZ = useCallback(
    (id: string, dir: 'front' | 'back' | 'up' | 'down') => {
      commit((d) => {
        d.pages.forEach((p) => {
          const el = p.els.find((e) => e.id === id)
          if (!el) return
          const sorted = [...p.els].sort((a, b) => a.z - b.z)
          const idx = sorted.findIndex((e) => e.id === id)
          if (dir === 'front') el.z = Math.max(...p.els.map((e) => e.z)) + 1
          else if (dir === 'back') el.z = Math.min(...p.els.map((e) => e.z)) - 1
          else if (dir === 'up' && idx < sorted.length - 1) el.z = sorted[idx + 1].z + 0.001
          else if (dir === 'down' && idx > 0) el.z = sorted[idx - 1].z - 0.001
        })
        return d
      })
    },
    [commit],
  )

  const toggleLock = useCallback(
    (id: string) => {
      commit((d) => {
        d.pages.forEach((p) => {
          p.els = p.els.map((e) => (e.id === id ? { ...e, locked: !e.locked } : e))
        })
        return d
      })
    },
    [commit],
  )

  const updatePage = useCallback(
    (patch: Partial<Doc>) => {
      commit((d) => ({ ...d, ...patch }))
    },
    [commit],
  )

  const resetDoc = useCallback(() => {
    commit(() => clone(INITIAL_DOC))
    setSelection(null)
    setEditingId(null)
    setPageIdxState(0)
  }, [commit])

  const importDoc = useCallback(
    (next: Doc) => {
      const normalized = normalizeDoc(next)
      commit(() => (isBrokenLayout(normalized) ? repairLayout(normalized) : reflowDoc(normalized)))
      setSelection(null)
      setPageIdxState(0)
    },
    [commit],
  )

  /* —— 自动存档 / 历史快照 —— */

  /** 立刻写一次（不等 400ms 防抖），并顺手打一份快照 */
  const saveNow = useCallback(() => {
    const raw = JSON.stringify(docRef.current)
    rawRef.current = raw
    const state = writeDocStorage(raw)
    if (state.ok) {
      lastWrittenRef.current = raw
      pushSnapshot(raw, docRef.current)
    }
    return state.ok
  }, [])

  /** 从 10 秒快照里恢复某一版（走 commit，可 Ctrl+Z 反悔） */
  const restoreSnapshot = useCallback(
    (at: number) => {
      const raw = snapshotAt(at)
      if (!raw) return false
      try {
        const parsed = JSON.parse(raw) as Doc
        if (!parsed || !Array.isArray(parsed.pages) || !parsed.pages.length) return false
        const normalized = normalizeDoc(parsed)
        commit(() => (isBrokenLayout(normalized) ? repairLayout(normalized) : reflowDoc(normalized)))
        setSelection(null)
        setEditingId(null)
        setPageIdxState(0)
        return true
      } catch {
        return false
      }
    },
    [commit],
  )

  /** 快照列表（读盘即可，不进 React state，避免无谓重渲染） */
  const getSnapshots = useCallback(() => listSnapshots(), [])

  /* —— 横竖版 / 自动排版 —— */

  const setOrientation = useCallback(
    (orientation: Orientation) => {
      const size = orientation === 'portrait' ? A4.portrait : A4.landscape
      commit((d) => resizeDoc(d, size.w, size.h))
    },
    [commit],
  )

  const setFlow = useCallback(
    (patch: Partial<FlowConfig>) => {
      commit((d) => {
        d.flow = { autoHeight: true, autoPage: true, ...d.flow, ...patch }
        return d.flow.autoPage ? reflowDoc(d) : d
      })
    },
    [commit],
  )

  const reflow = useCallback(() => {
    commit((d) => reflowDoc(d))
  }, [commit])

  /** 重建分页：修复误拖页眉/报头造成的空白页，把所有内容按阅读顺序装回 */
  const repair = useCallback(() => {
    commit((d) => repairLayout(d))
    setSelection(null)
    setPageIdxState(0)
  }, [commit])

  /** Canvas 测量出的真实文字高度：自动增高 + 下推 + 分页 */
  const applyMeasuredHeights = useCallback(
    (heights: Record<string, number>) => {
      const current = docRef.current
      if (current.flow?.autoHeight === false) return
      let any = false
      for (const page of current.pages) {
        for (const el of page.els) {
          if (!isMeasurable(el)) continue
          const h = heights[el.id]
          if (typeof h !== 'number') continue
          const target = Math.max(8, Math.ceil(h))
          // 锁高元素只在「内容装不下」时才算变化
          if (el.autoHeight === false && target <= el.h + 1) continue
          if (Math.abs(target - el.h) > 0.6) {
            any = true
            break
          }
        }
        if (any) break
      }
      if (!any) return
      commit((d) => applyHeights(d, heights, { growLocked: true }))
    },
    [commit],
  )

  /** 把当前图片变成当前页的全屏背景 */
  const makeBackground = useCallback(
    (id: string) => {
      commit((d) => {
        for (const page of d.pages) {
          const el = page.els.find((e) => e.id === id)
          if (!el) continue
          el.background = true
          el.variant = 'bg-image'
          el.x = 0
          el.y = 0
          el.w = d.w
          el.h = d.h
          el.z = -100
          el.autoHeight = false
        }
        return d
      })
    },
    [commit],
  )

  /** 给全部页面设置同一张全屏背景图（新页也会自动带） */
  const setPageBackground = useCallback(
    (src: string) => {
      commit((d) => {
        for (const page of d.pages) {
          let bg = page.els.find((e) => e.kind === 'image' && e.background && e.variant === 'bg-image')
          if (!bg) {
            bg = {
              id: uid('el'),
              kind: 'image',
              variant: 'bg-image',
              src,
              x: 0,
              y: 0,
              w: d.w,
              h: d.h,
              z: -100,
              background: true,
              autoHeight: false,
            }
            page.els.push(bg)
          } else {
            bg.src = src
            bg.x = 0
            bg.y = 0
            bg.w = d.w
            bg.h = d.h
            bg.z = -100
          }
        }
        return d
      })
    },
    [commit],
  )

  /** 文字块在页底按整行切开：上半段留在原位，下半段紧随其后，由分页引擎按栏顺序送走 */
  const splitTextElement = useCallback(
    (
      id: string,
      payload: { topHtml: string; topH: number; bottomHtml: string; bottomH: number },
    ) => {
      let newId = ''
      commit((d) => {
        for (let pi = 0; pi < d.pages.length; pi++) {
          const page = d.pages[pi]
          const src = page.els.find((e) => e.id === id)
          if (!src) continue
          const g = getGeometry(d, pi)
          const col = columnOf(g, src)
          const oldH = src.h
          const oldBottom = src.y + oldH

          src.html = payload.topHtml
          src.h = Math.max(8, Math.round(payload.topH * 10) / 10)
          const growth = Math.max(0, src.h - oldH)
          src.autoHeight = true
          src.noFlow = false
          src.continued = src.continued || undefined

          const copy: El = clone(src)
          copy.id = uid('el')
          newId = copy.id
          copy.html = payload.bottomHtml
          copy.h = Math.max(8, Math.round(payload.bottomH * 10) / 10)
          copy.autoHeight = true
          copy.continued = true
          copy.noFlow = false
          copy.y = src.y + src.h + PAGE_GAP
          copy.x = src.x
          copy.w = src.w
          copy.z = Math.max(0, ...page.els.map((e) => e.z)) + 0.5

          // 同栏后续内容整体下移，让续块插在正确阅读位置（源块之后、后续块之前）
          for (const other of page.els) {
            if (other.id === src.id || !isFlowable(other)) continue
            if (columnOf(g, other) !== col) continue
            if (other.y >= oldBottom - 0.5) other.y += growth + copy.h + PAGE_GAP
          }
          page.els.push(copy)
          break
        }
        return d.flow?.autoPage === false ? d : reflowDoc(d)
      })
      return newId
    },
    [commit],
  )

  /** 拖到某一页的指定位置（跨页拖放） */
  const moveElToPageAt = useCallback(
    (id: string, targetPage: number, x: number, y: number) => {
      commit((d) => {
        let el: El | null = null
        for (const page of d.pages) {
          const idx = page.els.findIndex((e) => e.id === id)
          if (idx >= 0) {
            el = page.els[idx]
            page.els.splice(idx, 1)
            break
          }
        }
        if (!el) return d
        ensurePage(d, Math.max(0, targetPage))
        // 跨页移动后置顶，避免被目标页高层级元素盖住
        el.z = Math.max(0, ...d.pages[Math.max(0, targetPage)].els.map((e) => e.z)) + 1
        el.x = x
        el.y = y
        placeNewElement(d, Math.max(0, targetPage), el)
        return d
      })
      setPageIdxState(Math.max(0, targetPage))
    },
    [commit],
  )

  const clearNoFlow = useCallback(
    (id: string) => {
      commit((d) => {
        let hit = false
        for (const page of d.pages) {
          for (const el of page.els) {
            if (el.id === id && el.noFlow) {
              el.noFlow = false
              hit = true
            }
          }
        }
        return hit && d.flow?.autoPage !== false ? reflowDoc(d) : d
      })
    },
    [commit],
  )

  const moveElToPage = useCallback(
    (id: string, targetIdx: number) => {
      commit((d) => moveElementToPage(d, id, targetIdx))
      setPageIdxState((p) => Math.max(0, targetIdx ?? p))
    },
    [commit],
  )

  const moveElToNextPage = useCallback(
    (id: string) => {
      const current = docRef.current
      let from = 0
      current.pages.forEach((p, i) => {
        if (p.els.some((e) => e.id === id)) from = i
      })
      commit((d) => moveElementToPage(d, id, from + 1))
    },
    [commit],
  )

  const addPage = useCallback(() => {
    commit((d) => addPagePure(d))
  }, [commit])

  const removePage = useCallback(
    (idx: number) => {
      commit((d) => removePagePure(d, idx))
      setPageIdxState((p) => Math.max(0, Math.min(p, docRef.current.pages.length - 1)))
    },
    [commit],
  )

  const setPageIdx = useCallback((next: number) => {
    setPageIdxState(Math.max(0, next))
  }, [])

  const snapVal = useCallback(
    (v: number) => (grid.snap ? Math.round(v / grid.cell) * grid.cell : Math.round(v * 10) / 10),
    [grid],
  )

  const isTxActive = useCallback(() => txActive.current, [])
  const getDoc = useCallback(() => docRef.current, [])

  return useMemo(
    () => ({
      doc,
      past,
      future,
      selection,
      subSelection,
      editingId,
      grid,
      zoom,
      pageIdx,
      orientation: doc.orientation ?? (doc.w > doc.h ? 'landscape' : 'portrait'),
      setPageIdx,
      setZoom,
      setGrid,
      setSelection,
      setEditingId,
      drawMode,
      setDrawMode,
      commit,
      undo,
      redo,
      saveNow,
      restoreSnapshot,
      getSnapshots,
      findEl,
      getDoc,
      updateEl,
      updateStyle,
      nudge,
      swapNeighbor,
      setSubSelection,
      updateSubStyle,
      nudgeSub,
      clearSubStyle,
      applyDefaultsToBody,
      beginTx,
      endTx,
      cancelTx,
      isTxActive,
      addEl,
      removeEl,
      duplicateEl,
      setZ,
      toggleLock,
      updatePage,
      resetDoc,
      importDoc,
      snapVal,
      setOrientation,
      setFlow,
      reflow,
      repair,
      applyMeasuredHeights,
      setPageBackground,
      makeBackground,
      splitTextElement,
      moveElToPageAt,
      clearNoFlow,
      moveElToPage,
      moveElToNextPage,
      addPage,
      removePage,
    }),
    [
      doc, past, future, selection, subSelection, editingId, grid, zoom, pageIdx, drawMode, setPageIdx, commit, undo, redo, findEl,
      getDoc, updateEl, updateStyle, nudge, swapNeighbor, setSubSelection, updateSubStyle, nudgeSub, clearSubStyle, applyDefaultsToBody, beginTx, endTx, cancelTx, isTxActive, addEl, removeEl,
      duplicateEl, setZ, toggleLock, updatePage, resetDoc, importDoc, snapVal, setOrientation, setFlow, reflow, repair, applyMeasuredHeights, setPageBackground, makeBackground, splitTextElement, moveElToPageAt, clearNoFlow, moveElToPage, moveElToNextPage, addPage, removePage,
      saveNow, restoreSnapshot, getSnapshots,
    ],
  )
}

export type EditorApi = ReturnType<typeof useEditor>

/** 供测试/调试导出 */
export { STORAGE_KEY }
