import { useMemo } from 'react'

/**
 * 水印：文字/密度等全部在 src/styles/newspaper.css 的
 * `--watermark-*` 变量里改，改完自动铺开（与设计稿行为一致）。
 */
export function Watermark() {
  const text = useMemo(() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--watermark-text')
    return raw.trim().replace(/"/g, '')
  }, [])
  return (
    <div className="watermark">
      <div className="watermark-inner">
        {/* 设计稿生成循环为 3×3 共 9 条 */}
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i}>{text}</span>
        ))}
      </div>
    </div>
  )
}

export function PrintButton() {
  return (
    <button className="print-btn" onClick={() => window.print()}>
      🖨 打印 / 导出 PDF
    </button>
  )
}

export function PageHeader() {
  return (
    <div className="header">
      <div className="header-left">
        <div className="header-title">
          地理时政周刊 <span>GEO WEEKLY</span>
        </div>
      </div>
      <div className="header-right">
        <div className="issue">第一期</div>
        <div>2026.10.25</div>
      </div>
    </div>
  )
}

export function Masthead() {
  return (
    <div className="masthead">
      <div className="kicker">期刊一</div>
      <h1>超强厄尔尼诺已经形成</h1>
      <div className="sub">
        海 — 气 相 互 作 用 {'\u00a0'}·{'\u00a0'} 全 球 气 候 异 常 {'\u00a0'}·{'\u00a0'} 高 考 必 考
      </div>
    </div>
  )
}

export function PageFooter({ no }: { no: number }) {
  return (
    <div className="footer">
      <div className="footer-top">
        <span>尺幅千里，卷纳乾坤</span>
        <span className="center">— {no} / 2 —</span>
        <span>思接寰宇，笔绘山河</span>
      </div>
      <div className="footer-bottom">
        <span>地理限时训练</span>
        <span>使用日期：2026年10月26日</span>
        <span>编辑：曹明环</span>
        <span>核对：何文静</span>
      </div>
    </div>
  )
}
