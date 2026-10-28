import type { El } from './types'

/** variant → 组件中文名（属性面板显示用） */
const NAMES: Record<string, string> = {
  // 标题 / 文本
  'masthead-text': '大标题',
  subtitle: '副标题',
  'section-title': '章节标题',
  subhead: '小标题',
  h4: '三级标题',
  numhead: '编号标题',
  kicker: '英文小标',
  lead: '导语',
  paragraph: '正文',
  labeled: '标签段',
  ulist: '无序列表',
  olist: '有序列表',
  req: '要求条目',
  quote: '金句 / 引用',
  stat: '数据强调',
  caption: '图注',
  byline: '署名 / 来源',

  // 内容框
  note: '提示框',
  concept: '概念框',
  chain: '逻辑链',
  trap: '易错提示',
  tpl: '答题模板',
  quiz: '测验题',
  quizgroup: '选择题组',
  material: '材料分析',
  card: '知识卡片',
  checklist: '考点清单',
  callout: '信息提示条',
  'callout-success': '成功提示条',
  'callout-warn': '警告提示条',

  // 数据 / 图表
  'stat-card': '数据卡片',
  compare: '左右对比',
  timeline: '时间线',
  table: '表格',
  formula: '公式 / 定义',

  // 版式
  toc: '本期导读',
  'editor-note': '编者按',
  'margin-note': '页边批注',
  qr: '二维码框',
  badges: '标签徽章',
  colorbar: '色块标题条',
  numbadge: '序号圆标',
  'rule-double': '双线分隔',
  'rule-dashed': '虚线分隔',
  'rule-dotted': '点线分隔',

  // 其他
  'name-row': '姓名学号',
  image: '图片',
  'bg-image': '全屏背景',
  line: '分隔线',
  region: '限制区域',
  header: '页眉',
  masthead: '报头',
  footer: '页脚',
}

const KIND_FALLBACK: Record<string, string> = {
  text: '文本组件',
  box: '内容框',
  image: '图片组件',
  chrome: '版式组件',
  line: '分隔线',
  region: '限制区域',
}

export function componentName(el: El): string {
  return NAMES[el.variant] ?? KIND_FALLBACK[el.kind] ?? '组件'
}
