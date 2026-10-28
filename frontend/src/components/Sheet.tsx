import type { Block } from '../data/content'
import { CornerMarks } from './CornerMarks'
import { SheetHeader } from './SheetHeader'
import { LogicalPage } from './LogicalPage'
import { PageFooter } from './PageFooter'

/** 一张纸（8开横向）= 左右两个逻辑页 */
export function Sheet({
  pages,
  startNo,
  total,
}: {
  pages: Block[][]
  startNo: number
  total: number
}) {
  return (
    <div className="sheet">
      <CornerMarks />
      <SheetHeader />
      <LogicalPage pageNo={startNo} blocks={pages[0]} />
      <LogicalPage pageNo={startNo + 1} blocks={pages[1]} />
      <PageFooter motto="尺幅千里，卷纳乾坤" pageNo={startNo} total={total} side="left" />
      <PageFooter motto="思接寰宇，笔绘山河" pageNo={startNo + 1} total={total} side="right" />
    </div>
  )
}
