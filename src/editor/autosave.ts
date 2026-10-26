/**
 * 自动存档
 *
 * 两条线并行：
 * 1. **主存档**：任何改动 400ms 后落地（`paiban-editor-doc-v1`），关掉页面/刷新都还在；
 * 2. **滚动快照**：编辑状态下每 10 秒打一份（`paiban-doc-snapshots-v1`，环形 12 份 ≈ 2 分钟），
 *    专治「手滑删了 / 拖乱了 / 误点了重置，然后才想起来」——刷新恢复后还能退回去。
 *
 * 存储预算：localStorage 一般 5MB，快照总占用压到 2.5MB 以内，
 * 单份太大（比如整页 base64 图）就只留最新一份，绝不为了快照把主存档挤掉。
 */

export const DOC_KEY = 'paiban-editor-doc-v1'
export const SNAP_KEY = 'paiban-doc-snapshots-v1'
export const SAVE_META_KEY = 'paiban-save-meta-v1'
/** 损坏存档的原样备份（不含时间戳，只留最近一次） */
export const CORRUPT_KEY = 'paiban-editor-doc-v1.corrupt'

/** 快照间隔：用户要的「10 秒无感保存」 */
export const SNAP_INTERVAL = 10_000
/** 最多保留份数 */
export const SNAP_LIMIT = 12
/** 快照总预算（字符数，UTF-16 近似字节） */
const SNAP_BUDGET = 2_500_000

export interface SnapshotMeta {
  at: number
  pages: number
  els: number
  bytes: number
}

interface SnapshotRecord extends SnapshotMeta {
  raw: string
}

export interface SaveState {
  /** 上次成功写盘时间 */
  at: number | null
  ok: boolean
  bytes: number
  /** 失败原因（配额满等） */
  error?: string
}

/* ------------------------------------------------------------------ *
 * 保存状态的「外部小仓库」
 *
 * 为什么不放进 useEditor 的 state：
 * 编辑器每改一次 doc 都要保存一次，保存结果一变就 setState → 整棵编辑器重渲染，
 * 正在进行的拖动（表格行列线、组件拖拽）会被打断。这里用订阅式小 store，
 * 只有工具栏那个角标订阅，画布完全不参与。
 * ------------------------------------------------------------------ */

let current: SaveState = { at: lastSavedAt(), ok: true, bytes: 0 }
const saveListeners = new Set<() => void>()

export function getSaveState(): SaveState {
  return current
}

export function subscribeSaveState(fn: () => void): () => void {
  saveListeners.add(fn)
  return () => {
    saveListeners.delete(fn)
  }
}

function publish(next: SaveState) {
  if (next.at === current.at && next.ok === current.ok && next.bytes === current.bytes && next.error === current.error) return
  current = next
  for (const fn of saveListeners) fn()
}

/** 从 doc 里数出页数/组件数，用于列表展示（不解析整个 doc） */
export function docBrief(doc: unknown): { pages: number; els: number } {
  const pages = (doc as { pages?: Array<{ els?: unknown[] }> })?.pages
  if (!Array.isArray(pages)) return { pages: 0, els: 0 }
  return {
    pages: pages.length,
    els: pages.reduce((n, p) => n + (Array.isArray(p?.els) ? p.els.length : 0), 0),
  }
}

function isQuotaError(err: unknown) {
  const name = (err as { name?: string })?.name ?? ''
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(String(err))
}

function readSnapshots(): SnapshotRecord[] {
  try {
    const raw = localStorage.getItem(SNAP_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { list?: SnapshotRecord[] }
    return Array.isArray(parsed?.list) ? parsed.list : []
  } catch {
    return []
  }
}

function writeSnapshots(list: SnapshotRecord[]) {
  localStorage.setItem(SNAP_KEY, JSON.stringify({ v: 1, list }))
}

/** 只留元信息给界面用（不含 raw，避免把几 MB 字符串塞进 React state） */
export function listSnapshots(): SnapshotMeta[] {
  return readSnapshots().map(({ at, pages, els, bytes }) => ({ at, pages, els, bytes }))
}

export function snapshotAt(at: number): string | null {
  const hit = readSnapshots().find((s) => s.at === at)
  return hit?.raw ?? null
}

/**
 * 打一份快照。内容与上一份完全相同则跳过（避免空转写盘）。
 * @returns 实际写入后的元信息列表
 */
export function pushSnapshot(raw: string, doc: unknown): SnapshotMeta[] {
  const list = readSnapshots()
  if (list[0]?.raw === raw) return list.map(({ at, pages, els, bytes }) => ({ at, pages, els, bytes }))

  const brief = docBrief(doc)
  list.unshift({ at: Date.now(), pages: brief.pages, els: brief.els, bytes: raw.length, raw })

  // 环形裁剪：份数 + 总预算双限
  const kept: SnapshotRecord[] = []
  let total = 0
  for (const s of list) {
    if (kept.length >= SNAP_LIMIT) break
    if (kept.length > 0 && total + s.raw.length > SNAP_BUDGET) break
    kept.push(s)
    total += s.raw.length
  }

  // 配额满就继续丢最旧的，直到写得进去（最差只留最新一份）
  while (kept.length) {
    try {
      writeSnapshots(kept)
      break
    } catch (err) {
      if (!isQuotaError(err) || kept.length === 1) {
        if (kept.length === 1) {
          try {
            localStorage.removeItem(SNAP_KEY)
          } catch {
            /* 忽略 */
          }
        }
        break
      }
      kept.pop()
    }
  }
  return kept.map(({ at, pages, els, bytes }) => ({ at, pages, els, bytes }))
}

/** 清空全部快照 */
export function clearSnapshots() {
  try {
    localStorage.removeItem(SNAP_KEY)
  } catch {
    /* 忽略 */
  }
}

/**
 * 写主存档。配额满时先牺牲快照再试一次——宁可少几份历史，也不能丢当前版面。
 * 结果会发布到保存状态的小仓库，只有订阅了它的工具栏会重渲染。
 */
export function writeDoc(raw: string): SaveState {
  const result = writeDocRaw(raw)
  publish(result)
  return result
}

function writeDocRaw(raw: string): SaveState {
  try {
    localStorage.setItem(DOC_KEY, raw)
  } catch (err) {
    clearSnapshots()
    try {
      localStorage.setItem(DOC_KEY, raw)
      return { at: Date.now(), ok: true, bytes: raw.length }
    } catch (err2) {
      return {
        at: null,
        ok: false,
        bytes: raw.length,
        error: isQuotaError(err2) ? '本机存储已满，自动保存失败' : String((err2 as Error)?.message || err2),
      }
    }
  }
  try {
    localStorage.setItem(SAVE_META_KEY, JSON.stringify({ at: Date.now(), bytes: raw.length }))
  } catch {
    /* 元信息写不进去不影响主存档 */
  }
  return { at: Date.now(), ok: true, bytes: raw.length }
}

/** 上一次成功保存的时间（刷新后也能显示） */
export function lastSavedAt(): number | null {
  try {
    const raw = localStorage.getItem(SAVE_META_KEY)
    if (!raw) return null
    const at = (JSON.parse(raw) as { at?: number })?.at
    return typeof at === 'number' ? at : null
  } catch {
    return null
  }
}

/** 存档损坏时先原样留一份，别让 400ms 后的自动保存把它盖掉 */
export function backupCorrupt(raw: string) {
  try {
    localStorage.setItem(CORRUPT_KEY, raw)
  } catch {
    /* 忽略 */
  }
}

export function readCorruptBackup(): string | null {
  try {
    return localStorage.getItem(CORRUPT_KEY)
  } catch {
    return null
  }
}

export const INITIAL_SAVE_STATE: SaveState = { at: null, ok: true, bytes: 0 }

/** 19:07:12 */
export function clockText(at: number) {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 刚刚 / 32 秒前 / 4 分钟前 / 19:07 */
export function agoText(at: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 5) return '刚刚'
  if (s < 60) return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  return clockText(at).slice(0, 5)
}

/** 123 KB */
export function bytesText(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
