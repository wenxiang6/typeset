/**
 * 后台管理请求层（alova 封装）。
 *
 * 约定：
 * - baseURL 指向 /api/admin，统一带 same-origin cookie（会话就是 HttpOnly cookie）
 * - 响应约定 {ok:true,...}，非 2xx 或 ok:false 统一抛 Error(message)，调用方只管 catch
 * - 需要「原文」而不是这个约定的接口（如 /api/admin/json 返回纯 JSON 文档），
 *   给 method 加 meta.raw = true，onSuccess 就把 Response 原样交回
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
      if (method.meta?.raw) return response
      const data = await response.json().catch(() => ({}))
      if (!response.ok || data.ok === false) {
        throw new Error((data as { error?: string }).error || `请求失败（${response.status}）`)
      }
      return data
    },
  },
})

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
  /** 取 JSON 原文（主稿 / 模板）。meta.raw：拿原始 Response 自己转文本 */
  getJsonRaw: (user: string, target: string) =>
    adminClient.Get<Response>('/json', {
      params: { user, target },
      meta: { raw: true },
    }).send(),
}
