/**
 * 裸域名门禁：体验令牌 / 弱密码令牌。
 *
 * 安全边界（与后端 gate.py 对齐）：
 * - 令牌是服务器 HMAC 签名的，过期/改密码都由服务器裁决，前端只负责显示；
 * - 倒计时每 30 秒向 /api/gate/remaining 校准一次（剩余秒数以服务器为准），
 *   控制台改本地变量只能骗显示，骗不了下一次校准和任何服务端判断。
 */

const KEY = 'paiban-gate-token'

export interface GateState {
  token: string
  mode: 'trial' | 'full'
  /** 服务器裁决的剩余秒数；full = -1（无限制） */
  remaining: number
  /** 上次校准时刻（本地 Date.now()），两次校准之间按秒递减显示 */
  syncedAt: number
}

let state: GateState | null = load()
const listeners = new Set<() => void>()

function load(): GateState | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GateState
    return parsed && parsed.token && parsed.mode ? parsed : null
  } catch {
    return null
  }
}

function persist() {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state))
    else localStorage.removeItem(KEY)
  } catch {
    /* 存不进去就只留内存态 */
  }
  for (const fn of listeners) fn()
}

export function getGate(): GateState | null {
  return state
}

export function subscribeGate(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function clearGate() {
  state = null
  persist()
}

/** 当前应显示的剩余秒数；full = -1；无令牌 = 0 */
export function currentRemaining(): number {
  if (!state) return 0
  if (state.mode === 'full') return -1
  const elapsed = Math.max(0, Math.round((Date.now() - state.syncedAt) / 1000))
  return Math.max(0, state.remaining - elapsed)
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; error?: string; token?: string; mode?: string; seconds?: number; expiresAt?: number }> {
  try {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
    return (await resp.json()) as { ok: boolean; error?: string; token?: string; mode?: string; seconds?: number; expiresAt?: number }
  } catch {
    return { ok: false, error: '网络不通，稍后再试' }
  }
}

/** 开启体验模式 */
export async function startTrial(): Promise<{ ok: boolean; error?: string }> {
  const r = await post('/api/gate/trial', {})
  if (!r.ok || !r.token) return { ok: false, error: r.error || '开启体验失败' }
  state = {
    token: r.token,
    mode: 'trial',
    remaining: r.seconds ?? 600,
    syncedAt: Date.now(),
  }
  persist()
  return { ok: true }
}

/** 弱密码进入 */
export async function gateLogin(password: string): Promise<{ ok: boolean; error?: string }> {
  const r = await post('/api/gate/login', { password })
  if (!r.ok || !r.token) return { ok: false, error: r.error || '密码不对' }
  state = {
    token: r.token,
    mode: 'full',
    remaining: -1,
    syncedAt: Date.now(),
  }
  persist()
  return { ok: true }
}

/**
 * 向服务器校准剩余时间。
 * 'ok' = 已更新；'invalid' = 令牌被服务器拒绝（已清掉）；'network' = 网络不通（放行本地态）。
 */
export async function syncRemaining(): Promise<'ok' | 'invalid' | 'network'> {
  if (!state) return 'invalid'
  try {
    const resp = await fetch('/api/gate/remaining', {
      headers: { 'X-Gate-Token': state.token },
      signal: AbortSignal.timeout(10000),
    })
    if (resp.status === 403) {
      clearGate()
      return 'invalid'
    }
    if (!resp.ok) return 'network'
    const data = (await resp.json()) as { mode?: string; remaining?: number }
    if (!state || (data.mode !== 'trial' && data.mode !== 'full')) return 'network'
    state.mode = data.mode
    state.remaining = typeof data.remaining === 'number' ? data.remaining : -1
    state.syncedAt = Date.now()
    persist()
    return 'ok'
  } catch {
    return 'network'
  }
}
