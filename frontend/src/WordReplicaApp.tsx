import { useEffect, useState } from 'react'
import type { Block } from './data/content'
import { pages, TOTAL_PAGES } from './data/content'
import { Sheet } from './components/Sheet'
import './styles/replica.css'

const SHEET_W = 2393
const SHEET_H = 1689
const GAP = 28

/**
 * 1:1 复刻版（按《地理时政周刊一.doc》原图逐像素还原）
 * 访问入口：/#/word
 */
export function WordReplicaApp() {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerWidth - 48) / SHEET_W))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const sheets: [Block[], Block[]][] = []
  for (let i = 0; i < pages.length; i += 2) {
    sheets.push([pages[i], pages[i + 1] ?? []])
  }
  const totalH = sheets.length * SHEET_H + (sheets.length - 1) * GAP

  return (
    <div className="viewer">
      <div style={{ width: SHEET_W * scale, height: totalH * scale, margin: '0 auto' }}>
        <div className="sheet-wrap" style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: SHEET_W }}>
          {sheets.map((pair, i) => (
            <Sheet key={i} pages={pair} startNo={i * 2 + 1} total={TOTAL_PAGES} />
          ))}
        </div>
      </div>
    </div>
  )
}
