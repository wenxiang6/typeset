import { IMAGES } from '../config/images'
import { SlotImage } from './Runs'

/** 页眉：校徽校名 + 训练标识 / 使用日期 / 编辑 / 核对 + 分隔线 */
export function SheetHeader() {
  return (
    <>
      <div className="school">
        <SlotImage
          src={IMAGES.logo}
          alt="校徽"
          className="school-logo"
          placeholderClass="school-logo placeholder"
          label=""
        />
        <div className="school-cn">廊坊衡英高级中学</div>
        <div className="school-en">LANGFANG HENGYING HIGH SCHOOL</div>
      </div>
      <div className="meta train">地理限时训练</div>
      <div className="meta date">使用日期：2026 年 10 月 26 日</div>
      <div className="meta editor">编辑：曹明环</div>
      <div className="meta checker">核对：何文静</div>
      <div className="header-rule" />
    </>
  )
}
