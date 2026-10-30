/**
 * 后台管理请求层（alova 封装）。
 *
 * 约定：
 * - baseURL 指向 /api/admin，统一带 same-origin cookie（会话就是 HttpOnly cookie）
 * - 响应约定 {ok:true,...}，非 2xx 或 ok:false 统一抛 Error(message)，调用方只管 catch
 * - 需要「原文」的接口（如 /api/admin/json 返回纯 JSON 文档）：meta.raw = true，
 *   onSuccess 里就地转成文本返回（Response.body 只能读一次，绝不能把 Response 交出去）
 */

import { createAlova } from 'alova'
import adapterFetch from 'alova/fetch'

export const adminClient = createAlova({
  requestAdapter: adapterFetch(),
  baseURL: '/api/admin',
  timeout: 15000,
  beforeRequest(method) {
    method.config.credentials = 'same-origin'
  },
  responded: {
    onSuccess: async (response, method) => {
      if (method.meta?.raw) {
        const text = await response.text()
        if (!response.ok) throw new Error(`读取失败（${response.status}）`)
        return text
      }
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) {
        throw new Error((data as { error?: string }).error || `请求失败（${response.status}）`)
      }
      return data
    },
  },
})

/* ---------------- JSON 原文缓存（LRU，超出上限覆盖最旧的） ---------------- */

const JSON_CACHE_LIMIT = 20
const jsonCache = new Map<string, string>()

export function cachedJson(key: string): string | undefined {
  return jsonCache.get(key)
}

function putJsonCache(key: string, text: string): void {
  if (jsonCache.has(key)) jsonCache.delete(key)
  jsonCache.set(key, text)
  if (jsonCache.size > JSON_CACHE_LIMIT) {
    jsonCache.delete(jsonCache.keys().next().value as string)
  }
}

/* ---------------- 类型 ---------------- */

export interface AdminUser {
  name: string
  createdAt: number
  lastActive: number
  docBytes: number
  snapshots: number
}

export interface Credential {
  name: string
  secret: string
  viewerUrl: string
  note?: string
}

export interface TreeNode {
  name: string
  doc: { at: number; bytes: number; pages: number } | null
  templates: { id: string; name: string; at: number; bytes: number }[]
}

/* ---------------- 接口 ---------------- */

export const adminApi = {
  session: () => adminClient.Get<{ ok: boolean }>('/session').send(),
  login: (password: string) =>
    adminClient.Post<{ ok: boolean }>('/login', { password }).send(),
  logout: () => adminClient.Post<{ ok: boolean }>('/logout').send(),
  listUsers: () => adminClient.Get<{ ok: boolean; users: AdminUser[] }>('/users').send(),
  addUser: (name: string) =>
    adminClient.Post<Credential>('/users', { name }).send(),
  deleteUser: (name: string) =>
    adminClient.Delete<{ ok: boolean }>(`/users/${encodeURIComponent(name)}`).send(),
  resetUser: (name: string) =>
    adminClient.Post<Credential>(`/users/${encodeURIComponent(name)}/reset`).send(),
  getTree: () => adminClient.Get<{ ok: boolean; tree: TreeNode[] }>('/tree').send(),
  /** 取 JSON 原文（主稿 / 模板）。带 LRU 缓存：命中直接返回；force=true 绕过缓存重新拉 */
  getJsonRaw: async (user: string, target: string, force = false): Promise<string> => {
    const key = `${user}:${target}`
    if (!force) {
      const hit = cachedJson(key)
      if (hit !== undefined) return hit
    }
    const text = (await adminClient
      .Get<string>('/json', {
        params: { user, target },
        meta: { raw: true },
      })
      .send()) as unknown as string
    putJsonCache(key, text)
    return text
  },
}
