/**
 * 水合状态：编辑器启动时「本地档/服务器稿哪份定型」还没确定前，落盘必须被锁住。
 *
 * 为什么存在（2026-11-05 事故）：新电脑上拉服务器稿若网络失败，内存里还是初始模板；
 * 旧逻辑直接解锁 → 用户一点画布，模板就被自动保存冲掉服务器真稿。
 * 现在拉取失败时 UI 显示载入遮罩并自动重试，只有三种情况解锁：
 *  1. 拿到确定态（服务器有稿 / 明确没稿）
 *  2. 本机有自己的存档（本机就是主存，离线照常编辑）
 *  3. 用户手动点「离线继续」（明确接受仅本机保存）
 */

export type HydrationStatus = 'pending' | 'done' | 'offline'

let status: HydrationStatus = 'pending'
let offlineRequested = false
const listeners = new Set<() => void>()

function emit() {
  for (const fn of listeners) fn()
}

export const hydration = {
  get: (): HydrationStatus => status,
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
  /** 载入循环把状态推进到这里（pending → done/offline） */
  set(next: HydrationStatus) {
    if (status === next) return
    status = next
    emit()
  },
  /** 用户在遮罩上点了「离线继续」 */
  requestOffline() {
    offlineRequested = true
    if (status !== 'offline') {
      status = 'offline'
      emit()
    }
  },
  /** 载入循环每轮醒来后看一眼：用户是否已要求离线 */
  isOfflineRequested(): boolean {
    return offlineRequested
  },
}
