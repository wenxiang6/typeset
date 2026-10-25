import type { Block } from '../data/content'
import { IMAGES } from '../config/images'
import { Runs, SlotImage } from './Runs'
import { TitleBlock } from './TitleBlock'

function BlockView({ b }: { b: Block }) {
  switch (b.k) {
    case 'issue':
      return (
        <div className="blk issue-title">
          <Runs runs={b.runs} />
        </div>
      )
    case 'note':
      return (
        <div className="blk note-line">
          <Runs runs={b.runs} />
        </div>
      )
    case 'h2':
      return (
        <div className="blk h2">
          <Runs runs={b.runs} />
        </div>
      )
    case 'h3':
      return (
        <div className="blk h3">
          <Runs runs={b.runs} />
        </div>
      )
    case 'item':
      return (
        <div className="blk item">
          <span className="marker">{b.marker}</span>
          <span className="body">
            <Runs runs={b.runs} />
          </span>
        </div>
      )
    case 'figure':
      return (
        <SlotImage
          src={IMAGES.figure}
          alt="期刊配图"
          className="figure-img"
          placeholderClass="figure placeholder"
          label="期刊配图（待替换）"
        />
      )
    default:
      return (
        <div className="blk p">
          <Runs runs={b.runs} />
        </div>
      )
  }
}

/**
 * 一个“逻辑页”= 一栏。奇数页在左栏，偶数页在右栏。
 * 第 1 页顶部有标题区（主标题/姓名框/双线）与配图，按参考图坐标绝对定位。
 */
export function LogicalPage({ pageNo, blocks }: { pageNo: number; blocks: Block[] }) {
  const left = (pageNo - 1) % 2 === 0 ? 149 : 1253
  const isCover = pageNo === 1
  const flowTop = isCover ? 999 : 85

  const furniture = isCover ? blocks.filter((b) => b.k === 'issue' || b.k === 'figure') : []
  const flowBlocks = isCover ? blocks.filter((b) => b.k !== 'issue' && b.k !== 'figure') : blocks

  return (
    <>
      {isCover && <TitleBlock />}
      {furniture.map((b, i) => (
        <div key={i} className={b.k === 'issue' ? 'furniture issue-abs' : 'furniture figure-abs'}>
          <BlockView b={b} />
        </div>
      ))}
      <div className="page-body" style={{ left, top: flowTop }}>
        {flowBlocks.map((b, i) => (
          <BlockView key={i} b={b} />
        ))}
      </div>
    </>
  )
}
