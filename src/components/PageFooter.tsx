/** 页脚：格言 + 页码。左右两半的中心位置按参考图固定。 */
export function PageFooter({
  motto,
  pageNo,
  total,
  side,
}: {
  motto: string
  pageNo: number
  total: number
  side: 'left' | 'right'
}) {
  const mottoCenter = side === 'left' ? 544 : 1692
  const numCenter = side === 'left' ? 554 : 1702
  return (
    <>
      <div
        className="page-footer"
        style={{ left: mottoCenter - 300, width: 600, top: 1610 }}
      >
        {motto}
      </div>
      <div
        className="page-footer"
        style={{ left: numCenter - 300, width: 600, top: 1638 }}
      >
        第 {pageNo} 页 共 {total} 页
      </div>
    </>
  )
}
