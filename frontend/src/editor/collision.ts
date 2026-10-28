/**
 * 兼容入口：避让算法已迁移到 layout.ts（与分页/自动高度共用同一套几何）。
 * 新代码请直接使用 resolveMove。
 */
import type { Doc } from './types'
import { resolveMove, type Rect } from './layout'

export { overlaps, isFlowable } from './layout'
export type { MoveResolution, Rect } from './layout'

/** @deprecated 使用 resolveMove；保留给旧调用点做自动避让 */
export function resolveCollisions(doc: Doc, pageIdx: number, movingId: string, movingRect: Rect): Map<string, Rect> {
  const el = doc.pages[pageIdx]?.els.find((e) => e.id === movingId)
  const prev = el ? { x: el.x, y: el.y, w: el.w, h: el.h } : movingRect
  return resolveMove(doc, pageIdx, movingId, movingRect, prev).pushed
}
