/** 排版编辑器数据模型 */

export type ElementKind = 'text' | 'box' | 'image' | 'chrome' | 'line' | 'region'
export type Orientation = 'landscape' | 'portrait'

export interface FlowConfig {
  /** 文字块按真实内容自动增高/回落 */
  autoHeight: boolean
  /** 超出页底自动流到下一页 */
  autoPage: boolean
}

export interface DocMargins {
  top: number
  right: number
  bottom: number
  left: number
}

/** 复合组件内部元素（如报头的期刊一/主标题/副标题）的单独样式覆盖 */
export interface SubStyle {
  fontFamily?: string
  fontSize?: string
  fontWeight?: string
  italic?: boolean
  underline?: boolean
  color?: string
  lineHeight?: string
  letterSpacing?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  /** 相对原位置的微调偏移 */
  dx?: number
  dy?: number
}

export interface ElStyle {
  fontFamily?: string
  fontSize?: string
  fontWeight?: string
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string
  background?: string
  lineHeight?: string
  letterSpacing?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  opacity?: number
  rotate?: number
  padding?: string
  /** 边框/分隔线宽度，例如 '2px'；作用于该组件的线 */
  lineWidth?: string
}

export interface El {
  id: string
  kind: ElementKind
  /** 样式变体：决定用哪套模板样式（note/tpl/quiz/…） */
  variant: string
  /** 富文本内容（含模板原有标签与类名，保证与设计稿一致） */
  html?: string
  /** 图片地址（kind === 'image'） */
  src?: string
  /** 区域名称（kind === 'region'） */
  label?: string
  x: number
  y: number
  w: number
  h: number
  z: number
  locked?: boolean
  /** 背景元素（如背景图）：不参与防重叠，允许与其它组件重叠 */
  background?: boolean
  /** 文字块是否随内容自动增高（手动改高度后自动关闭） */
  autoHeight?: boolean
  /** 是否为跨页切割后生成的续块 */
  continued?: boolean
  /** 内部标记：等待继续切割的续块，暂时不参与整块翻页 */
  noFlow?: boolean
  style?: ElStyle
  /** 内部元素样式覆盖：key 为组件根节点下直接子元素的序号 */
  sub?: Record<string, SubStyle>
}

export interface DocPage {
  id: string
  els: El[]
}

export interface Watermark {
  text: string
  size: number
  opacity: number
  angle: number
}

export interface DocDefaults {
  /** 默认正文字体（黑体） */
  fontFamily: string
  /** 默认正文字号（五号 = 10.5pt = 14px） */
  fontSize: string
}

export interface Doc {
  w: number
  h: number
  /** 纸张方向：全局统一 A4 横版 / 竖版 */
  orientation?: Orientation
  margin?: DocMargins
  /** 自动排版开关 */
  flow?: FlowConfig
  /** 存档结构版本，用于旧存档迁移 */
  version?: number
  watermark: Watermark
  defaults: DocDefaults
  pages: DocPage[]
}

export interface GridConfig {
  show: boolean
  snap: boolean
  cell: number
}
