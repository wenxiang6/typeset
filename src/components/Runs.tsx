import { useState } from 'react'
import type { Run } from '../data/content'

/** 渲染富文本 run（加粗与原文档一致） */
export function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => (r.b ? <b key={i}>{r.t}</b> : <span key={i}>{r.t}</span>))}
    </>
  )
}

/**
 * 图片位：src 加载失败（未提供图片时）自动降级为占位框，
 * 换图只改 src，无需改组件。
 */
export function SlotImage({
  src,
  alt,
  className,
  placeholderClass,
  label,
}: {
  src: string
  alt: string
  className?: string
  placeholderClass?: string
  label: string
}) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div className={placeholderClass} role="img" aria-label={alt}>
        {label}
      </div>
    )
  }
  return (
    <img
      className={className}
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
    />
  )
}
