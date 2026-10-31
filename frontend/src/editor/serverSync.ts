/**
 * 服务器同步镜像层（尽力而为，不阻塞主流程）
 *
 * 背景：localStorage 绑定「浏览器 + 设备」，换浏览器/换电脑数据就没了。
 * 这里把主存档 / 快照 / 模板库异步镜像到部署服务器（PostgreSQL），
 * 本地仍是主存（同步、快），服务器是跨设备备份。
 *
 * 多用户（2026-10-30 起）：
 * - 凭证 = md5(name + ':' + secret)，通过 ?u=<name>&k=<md5> 链接带来，
 *   首次打开写入 localStorage，之后所有 /api 请求自动带上
 * - 401（凭证无效/被重置）→ 页面顶部横幅明确提示，绝不静默
 *
 * 设计原则：
 * - 全部 fire-and-forget：镜像失败静默吞掉，绝不影响本地保存体验；
 * - 探活只做一次（缓存 Promise），服务器不可用时全部调用立刻空转；
 * - 恢复方向：本机没有存档而服务器有 → 启动时从服务器拉回来。
 */

const CRED_KEY = 'paiban-cred'
let healthPromise: Promise<boolean> | null = null
let credCache: { u: string; k: string } | null | undefined

import { queryClient } from '../lib/queryClient'

/** 凭证：URL ?u=&k= 优先（写入 localStorage），否则读本地存的 */
function credential(): { u: string; k: string } | null {
  if (credCache !== undefined) return credCache
  try {
    const sp = new URLSearchParams(window.location.search)
    const u = sp.get('u')
    const k = sp.get('k')
    if (u && k) {
      credCache = { u, k }
      localStorage.setItem(CRED_KEY, JSON.stringify(credCache))
      return credCache
    }
    const saved = localStorage.getItem(CRED_KEY)
    credCache = saved ? (JSON.parse(saved) as { u: string; k: string }) : null
  } catch {
    credCache = null
  }
  return credCache
}

/** URL 里是否直接带了 ?u=&k=（区别于本机记住的旧凭证） */
export function hasUrlCredential(): boolean {
  try {
    const sp = new URLSearchParams(window.location.search)
    return Boolean(sp.get('u') && sp.get('k'))
  } catch {
    return false
  }
}

/** 清掉本机记住的凭证（门卫检测到已失效时调用，让位给门禁页） */
export function clearSavedCredential() {
  try {
    localStorage.removeItem(CRED_KEY)
  } catch {
    /* 忽略 */
  }
  if (!hasUrlCredential()) credCache = null
}

/** 凭证 query 片段；没有凭证返回空串 */
function credQuery(): string {
  const c = credential()
  if (!c) return ''
  return `u=${encodeURIComponent(c.u)}&k=${encodeURIComponent(c.k)}`
}

/** 模块加载即解析凭证（URL ?u=&k= 在脚本启动时就在），供 userKey() 等同步场景使用 */
credCache = credential()

/** 当前凭证用户名；未带凭证返回 null。本地存档按用户隔离时用 */
export function currentUserName(): string | null {
  return credential()?.u ?? null
}

function withCred(path: string): string {
  const q = credQuery()
  if (!q) return path
  return path + (path.includes('?') ? '&' : '?') + q
}

let authBannerShown = false
/** 401：凭证无效或被重置。本地数据不受影响，但不能同步/拉取。 */
function notifyAuthError() {
  // 本机记住的凭证失效：由 CredGate 门卫处理（清凭证 → 门禁页），不弹横幅
  // （横幅只留给「链接里就带着错凭证」的情况——那种该明说链接坏了）
  if (!hasUrlCredential()) return
  if (authBannerShown) return
  authBannerShown = true
  try {
    const div = document.createElement('div')
    div.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b91c1c;color:#fff;' +
      'padding:10px 16px;font:13px/1.5 system-ui,sans-serif;text-align:center'
    div.textContent =
      '访问凭证无效或已被重置——本地编辑不受影响，但无法同步服务器。请通过你的个人链接（含 ?u=&k=）重新打开本页。'
    document.body.appendChild(div)
  } catch {
    /* 页面还没挂载 body 的极端情况：下次 401 再试 */
    authBannerShown = false
  }
}

/** 服务器持久化是否可用（结果缓存，整个会话只探一次） */
export function serverAvailable(): Promise<boolean> {
  if (!healthPromise) {
    healthPromise = fetch('/api/health', { signal: AbortSignal.timeout(3000) })
      .then((r) => r.ok)
      .catch(() => false)
  }
  return healthPromise
}

export type CredCheck = 'ok' | 'invalid' | 'unknown'
let credCheckPromise: Promise<CredCheck> | null = null

/**
 * 启动时校验凭证（URL ?u=&k= 或本机记住的）。
 * 只有服务器明确拒绝（401）才算 invalid——跨境链路抖动/超时一律 unknown，
 * 宁可放行空编辑器也绝不把正常用户挡在门外。
 */
export function checkCredentials(): Promise<CredCheck> {
  if (!credCheckPromise) {
    credCheckPromise = (async () => {
      if (!credential()) return 'ok' // 无凭证：单机模式，不拦
      try {
        const resp = await fetch(withCred('/api/verify'), { signal: AbortSignal.timeout(10000) })
        if (resp.ok) return 'ok'
        if (resp.status === 401) return 'invalid'
        return 'unknown'
      } catch {
        return 'unknown'
      }
    })()
  }
  return credCheckPromise
}

async function mirrorPut(path: string, body: string, json = false) {
  try {
    if (!(await serverAvailable())) return
    const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : { 'Content-Type': 'text/plain' }
    const resp = await fetch(withCred(path), { method: 'PUT', headers, body, signal: AbortSignal.timeout(15000) })
    if (resp.status === 401) notifyAuthError()
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
  const cred = credential()
  // TanStack Query 收编：同 key 请求在 staleTime 内去重，编辑器轮询和启动恢复共享缓存
  return queryClient.fetchQuery({
    queryKey: ['server-doc-meta', cred?.u ?? 'anon'],
    queryFn: async () => {
      try {
        if (!(await serverAvailable())) return null
        const resp = await fetch(withCred('/api/doc'), { signal: AbortSignal.timeout(10000) })
        if (resp.status === 401) {
          notifyAuthError()
          return null
        }
        if (!resp.ok) return null
        const data = (await resp.json()) as { raw?: string | null; at?: number; pushedAt?: number }
        if (typeof data.raw !== 'string' || !data.raw) return null
        return { raw: data.raw, at: Number(data.at ?? 0), pushedAt: Number(data.pushedAt ?? 0) } as ServerDocMeta
      } catch {
        return null
      }
    },
    staleTime: 3000,
    retry: false,
  })
}

/** 从服务器拉模板库列表；没有或不可用返回 null */
export async function fetchServerTemplates(): Promise<unknown[] | null> {
  const cred = credential()
  return queryClient.fetchQuery({
    queryKey: ['server-templates', cred?.u ?? 'anon'],
    queryFn: async () => {
      try {
        if (!(await serverAvailable())) return null
        const resp = await fetch(withCred('/api/templates'), { signal: AbortSignal.timeout(10000) })
        if (resp.status === 401) {
          notifyAuthError()
          return null
        }
        if (!resp.ok) return null
        const data = (await resp.json()) as { list?: unknown[] }
        return Array.isArray(data.list) ? data.list : null
      } catch {
        return null
      }
    },
    staleTime: 5000,
    retry: false,
  })
}
