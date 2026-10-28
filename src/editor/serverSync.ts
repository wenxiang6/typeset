/**
 * 服务器同步镜像层（尽力而为，不阻塞主流程）
 *
 * 背景：localStorage 绑定「浏览器 + 设备」，换浏览器/换电脑数据就没了。
 * 这里把主存档 / 快照 / 模板库异步镜像到部署服务器（SQLite），
 * 本地仍是主存（同步、快），服务器是跨设备备份。
 *
 * 设计原则：
 * - 全部 fire-and-forget：镜像失败静默吞掉，绝不影响本地保存体验；
 * - 探活只做一次（缓存 Promise），服务器不可用（如 Electron 桌面版）时全部调用立刻空转；
 * - 恢复方向：本机没有存档而服务器有 → 启动时从服务器拉回来。
 */

let healthPromise: Promise<boolean> | null = null

/** 服务器持久化是否可用（结果缓存，整个会话只探一次） */
export function serverAvailable(): Promise<boolean> {
  if (!healthPromise) {
    healthPromise = fetch('/api/health', { signal: AbortSignal.timeout(3000) })
      .then((r) => r.ok)
      .catch(() => false)
  }
  return healthPromise
}

async function mirrorPut(path: string, body: string, json = false) {
  try {
    if (!(await serverAvailable())) return
    const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'text/plain' }
    await fetch(path, { method: 'PUT', headers, body, signal: AbortSignal.timeout(15000) })
  } catch {
    /* 镜像失败不影响本地 */
  }
}

/** 镜像主存档（raw 是序列化后的 doc JSON 字符串） */
export function mirrorDoc(raw: string) {
  void mirrorPut('/api/doc', raw)
}

/** 镜像快照列表（含 raw 内容，环形上限内的全部） */
export function mirrorSnapshots(list: readonly unknown[]) {
  void mirrorPut('/api/snapshots', JSON.stringify({ v: 1, list }), true)
}

/** 镜像模板库列表 */
export function mirrorTemplates(list: readonly unknown[]) {
  void mirrorPut('/api/templates', JSON.stringify(list), true)
}

/** 从服务器拉主存档；没有或不可用返回 null */
export async function fetchServerDoc(): Promise<string | null> {
  const meta = await fetchServerDocMeta()
  return meta?.raw ?? null
}

export interface ServerDocMeta {
  raw: string
  /** 服务器上这份 doc 的最后写入时间 */
  at: number
  /** 最后一次「外部推送」（排版 skill / 脚本带 ?push=1）的时间；0 表示从没推送过 */
  pushedAt: number
}

/**
 * 读主存档 + 时间戳。
 * pushedAt 用来判断「是否有别处推来的新稿」：编辑器自己的自动保存只更新 at，
 * 只有外部工具推送才会改 pushedAt，所以不会出现自己冲掉自己的情况。
 */
export async function fetchServerDocMeta(): Promise<ServerDocMeta | null> {
  try {
    if (!(await serverAvailable())) return null
    const resp = await fetch('/api/doc', { signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return null
    const data = (await resp.json()) as { raw?: string | null; at?: number; pushedAt?: number }
    if (typeof data.raw !== 'string' || !data.raw) return null
    return { raw: data.raw, at: Number(data.at ?? 0), pushedAt: Number(data.pushedAt ?? 0) }
  } catch {
    return null
  }
}

/** 从服务器拉模板库列表；没有或不可用返回 null */
export async function fetchServerTemplates(): Promise<unknown[] | null> {
  try {
    if (!(await serverAvailable())) return null
    const resp = await fetch('/api/templates', { signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return null
    const data = (await resp.json()) as { list?: unknown[] }
    return Array.isArray(data.list) ? data.list : null
  } catch {
    return null
  }
}
