import { useEffect, useState } from 'react'
import type { El } from './types'
import type { EditorApi } from './store'
import {
  IconBookmark, IconChart, IconClipboard, IconCompare, IconFlow, IconFormula, IconHeading,
  IconIdCard, IconImage, IconInfoBox, IconListCheck, IconListOl, IconListUl, IconMinus, IconParagraph,
  IconQr, IconQuiz, IconRegion, IconSticky, IconSubhead, IconTable, IconTag, IconTimeline,
  IconTitle, IconWarning,
} from './icons'

interface PaletteItem {
  label: string
  hint: string
  icon: React.ReactNode
  el: Omit<El, 'id' | 'z' | 'x' | 'y'>
}

interface PaletteGroup {
  title: string
  items: PaletteItem[]
}

const GROUPS: PaletteGroup[] = [
  {
    title: '标题 / 导读',
    items: [
      {
        label: '大标题',
        hint: '报头级大字标题（26px 加粗宽字距）。双击改字，右侧可改字号字色。',
        icon: <IconTitle />,
        el: { kind: 'text', variant: 'masthead-text', w: 500, h: 40, html: '<h1 style="font-size:26px;font-weight:900;letter-spacing:3px;line-height:1.1;margin:0">大标题</h1>' },
      },
      {
        label: '副标题',
        hint: '居中副标题 / 内容提要，18px 加粗，适合放在主标题下方。',
        icon: <IconSubhead />,
        el: { kind: 'text', variant: 'subtitle', w: 509, h: 30, html: '<h2 class="w-subtitle">副标题 / 内容提要</h2>' },
      },
      {
        label: '章节标题',
        hint: '带编号底纹的小节标题（一、二、三…）。编号可双击修改。',
        icon: <IconHeading />,
        el: { kind: 'chrome', variant: 'section-title', w: 509, h: 20, html: '<div class="section-title"><span class="num">一</span><h2>新章节标题</h2></div>' },
      },
      {
        label: '小标题',
        hint: '段内小标题（1. 2. 3. 级），默认黑体加粗。',
        icon: <IconSubhead />,
        el: { kind: 'text', variant: 'subhead', w: 300, h: 20, html: '<h3>小标题</h3>' },
      },
      {
        label: '三级标题',
        hint: '左侧粗线小标题（h4），比小标题更轻，适合条目细分。',
        icon: <IconSubhead />,
        el: { kind: 'text', variant: 'h4', w: 300, h: 22, html: '<h4 class="w-h4">三级标题</h4>' },
      },
      {
        label: '编号标题',
        hint: '黑底序号 + 标题 + 下划线，适合“01 / 02”式栏目。',
        icon: <IconHeading />,
        el: { kind: 'text', variant: 'numhead', w: 509, h: 28, html: '<div class="w-numhead"><span>01</span><h3>编号标题</h3></div>' },
      },
      {
        label: '英文小标',
        hint: '大写字距小标（GEO WEEKLY / 2026），用于报纸装饰。',
        icon: <IconTitle />,
        el: { kind: 'text', variant: 'kicker', w: 300, h: 16, html: '<div class="w-kicker">GEO WEEKLY · 2026</div>' },
      },
      {
        label: '导语',
        hint: '左粗线导语段，16px、行距舒展，用于本期开场。',
        icon: <IconParagraph />,
        el: { kind: 'text', variant: 'lead', w: 509, h: 60, html: '<p class="w-lead">导语：用两三句话概括本期核心看点，吸引读者继续阅读。</p>' },
      },
    ],
  },
  {
    title: '文本',
    items: [
      {
        label: '正文',
        hint: '普通段落文字，默认黑体五号。双击进入行内编辑，可选中部分文字加粗/变色。',
        icon: <IconParagraph />,
        el: { kind: 'text', variant: 'paragraph', w: 509, h: 24, html: '<p>这里是正文内容，双击可编辑。</p>' },
      },
      {
        label: '标签段',
        hint: '标签 + 正文的段落（如「定义：……」），标签自动加粗。',
        icon: <IconTag />,
        el: { kind: 'text', variant: 'labeled', w: 509, h: 24, html: '<p><span class="label">标签：</span>正文内容。</p>' },
      },
      {
        label: '要求',
        hint: '学习要求/要点条目（1. 2. 3. 编号），蓝色编号。',
        icon: <IconListCheck />,
        el: { kind: 'text', variant: 'req', w: 509, h: 22, html: '<div class="req">1. 条目内容；</div>' },
      },
      {
        label: '金句',
        hint: '灰底大引号引用块，适合放金句、原文引用、专家观点。',
        icon: <IconBookmark />,
        el: { kind: 'box', variant: 'quote', w: 509, h: 60, html: '<blockquote class="w-quote">这里是金句或引用内容，双击可修改。</blockquote>' },
      },
      {
        label: '数据强调',
        hint: '大号数字 + 说明，用于突出关键数据（如 +0.5℃、2—7 年）。',
        icon: <IconChart />,
        el: { kind: 'box', variant: 'stat', w: 300, h: 50, html: '<div class="w-stat"><b>+0.5℃</b><span>海温距平判定阈值</span></div>' },
      },
      {
        label: '图注',
        hint: '图片下方说明文字，小号居中（图 1 · ……）。',
        icon: <IconParagraph />,
        el: { kind: 'text', variant: 'caption', w: 509, h: 18, html: '<p class="w-caption">图 1 · 沃克环流示意图（双击修改图注）</p>' },
      },
      {
        label: '署名',
        hint: '右对齐小号来源、作者、编辑信息。',
        icon: <IconIdCard />,
        el: { kind: 'text', variant: 'byline', w: 300, h: 18, html: '<p class="w-byline">来源：中国气象局 · 编辑：曹明环</p>' },
      },
    ],
  },
  {
    title: '列表',
    items: [
      {
        label: '无序列表',
        hint: '项目符号列表，支持圆点/空心圆/方块/对勾/箭头/短横/双列/卡片等模板，右侧可切换。',
        icon: <IconListUl />,
        el: { kind: 'box', variant: 'ulist', w: 509, h: 96, autoHeight: true, html: '<ul class="w-list" data-list-style="disc"><li>列表要点一</li><li>列表要点二</li><li>列表要点三</li></ul>' },
      },
      {
        label: '有序列表',
        hint: '编号列表，支持数字/前导零/字母/罗马/中文/括号/大号数字等模板，右侧可切换。',
        icon: <IconListOl />,
        el: { kind: 'box', variant: 'olist', w: 509, h: 96, autoHeight: true, html: '<ol class="w-list" data-list-style="decimal"><li>第一步</li><li>第二步</li><li>第三步</li></ol>' },
      },
    ],
  },
  {
    title: '内容框',
    items: [
      {
        label: '提示框',
        hint: '灰底加粗提示块，用于「教材核心定义」「注意」等强调内容。',
        icon: <IconInfoBox />,
        el: { kind: 'box', variant: 'note', w: 509, h: 60, html: '<div class="note"><strong>提示：</strong>提示内容。</div>' },
      },
      {
        label: '概念框',
        hint: '概念/定义卡片（名词：解释），左侧竖线灰底。',
        icon: <IconBookmark />,
        el: { kind: 'box', variant: 'concept', w: 509, h: 34, html: '<div class="concept-box"><span class="name">名词：</span>解释内容。</div>' },
      },
      {
        label: '逻辑链',
        hint: '箭头因果链（起点→过程→结果），适合成因推理。',
        icon: <IconFlow />,
        el: {
          kind: 'box',
          variant: 'chain',
          w: 509,
          h: 50,
          html: '<div class="chain"><span class="node">起点</span><span class="arrow">→</span><span class="node">过程</span><span class="arrow">→</span><span class="node">结果</span></div>',
        },
      },
      {
        label: '易错',
        hint: '✕ 易错点警示，用于辨析常见错误。',
        icon: <IconWarning />,
        el: { kind: 'box', variant: 'trap', w: 509, h: 26, html: '<div class="trap"><span class="x">✕</span><span class="t">易错点内容。</span></div>' },
      },
      {
        label: '答题模板',
        hint: '粗边框模板卡（【模板标题】+ 条目），用于答题套路。',
        icon: <IconClipboard />,
        el: {
          kind: 'box',
          variant: 'tpl',
          w: 509,
          h: 90,
          html: '<div class="tpl"><h4>【模板标题】</h4><p><span class="label">模板条目：</span>模板内容。</p></div>',
        },
      },
      {
        label: '测验题',
        hint: '题目/答案/解析卡片，含答案解析区。',
        icon: <IconQuiz />,
        el: {
          kind: 'box',
          variant: 'quiz',
          w: 509,
          h: 90,
          html: '<div class="quiz"><p><strong>题目内容（  ）</strong></p><p><span class="ans">答案：</span><span class="exp">解析：</span></p></div>',
        },
      },
      {
        label: '选择题组',
        hint: '2 道选择题合并成一个组件，适合限时训练。',
        icon: <IconQuiz />,
        el: {
          kind: 'box',
          variant: 'quizgroup',
          w: 509,
          h: 130,
          html:
            '<div class="w-quizgroup"><div class="q"><p><strong>1. 题目内容（  ）</strong></p><p>A. 选项一　B. 选项二　C. 选项三　D. 选项四</p><p><span class="ans">答案：B</span> <span class="exp">解析：……</span></p></div><div class="q"><p><strong>2. 题目内容（  ）</strong></p><p>A. 选项一　B. 选项二　C. 选项三　D. 选项四</p><p><span class="ans">答案：C</span> <span class="exp">解析：……</span></p></div></div>',
        },
      },
      {
        label: '材料分析',
        hint: '黑头「材料分析」框：材料 + 设问 + 参考答案。',
        icon: <IconClipboard />,
        el: {
          kind: 'box',
          variant: 'material',
          w: 509,
          h: 140,
          html:
            '<div class="w-material"><div class="head">材料分析</div><div class="body"><p>材料：阅读图文材料，完成下列问题。</p><p><strong>设问：</strong>简述厄尔尼诺现象的形成机制。</p><p class="ans">答案：东南信风减弱，西太平洋暖水向东输送……</p></div></div>',
        },
      },
      {
        label: '知识卡片',
        hint: '顶部粗线卡片：标题 + 要点，适合知识点/名词卡片。',
        icon: <IconBookmark />,
        el: {
          kind: 'box',
          variant: 'card',
          w: 509,
          h: 90,
          html: '<div class="w-card"><h4>知识卡片 · 沃克环流</h4><p>赤道太平洋纬向热力环流，海温异常会改变其强度与方向。</p></div>',
        },
      },
      {
        label: '考点清单',
        hint: '带方框的清单，适合必背考点、检查项。',
        icon: <IconListCheck />,
        el: {
          kind: 'box',
          variant: 'checklist',
          w: 509,
          h: 100,
          html:
            '<div class="w-checklist"><div class="item"><i class="box"></i><span>掌握厄尔尼诺的形成逻辑链</span></div><div class="item"><i class="box"></i><span>区分厄尔尼诺与拉尼娜的影响</span></div><div class="item"><i class="box"></i><span>能结合时政材料分析气候异常</span></div></div>',
        },
      },
      {
        label: '信息条',
        hint: '蓝色左边框提示条，适合补充说明。',
        icon: <IconInfoBox />,
        el: { kind: 'box', variant: 'callout', w: 509, h: 40, html: '<div class="w-callout"><strong>提示：</strong>这里是一条补充说明。</div>' },
      },
      {
        label: '成功条',
        hint: '绿色左边框提示条，适合正确答案、达成目标。',
        icon: <IconInfoBox />,
        el: { kind: 'box', variant: 'callout-success', w: 509, h: 40, html: '<div class="w-callout success"><strong>正确：</strong>这里是一条成功提示。</div>' },
      },
      {
        label: '警告条',
        hint: '橙色左边框提示条，适合易错点、风险提醒。',
        icon: <IconWarning />,
        el: { kind: 'box', variant: 'callout-warn', w: 509, h: 40, html: '<div class="w-callout warn"><strong>注意：</strong>这里是一条警告提示。</div>' },
      },
    ],
  },
  {
    title: '数据 / 图表',
    items: [
      {
        label: '数据卡片',
        hint: '卡片内放大号数据 + 说明，适合核心指标。',
        icon: <IconChart />,
        el: {
          kind: 'box',
          variant: 'stat-card',
          w: 509,
          h: 100,
          html: '<div class="w-card"><h4>核心数据</h4><div class="w-stat"><b>2—7</b><span>年 / 厄尔尼诺周期</span></div><p>海温距平 ≥ +0.5℃，持续数月即可判定。</p></div>',
        },
      },
      {
        label: '左右对比',
        hint: '两栏对比卡，适合厄尔尼诺 vs 拉尼娜、东岸 vs 西岸。',
        icon: <IconCompare />,
        el: {
          kind: 'box',
          variant: 'compare',
          w: 509,
          h: 120,
          html: '<div class="w-compare"><div><h4>厄尔尼诺</h4><p>中东太平洋异常增温，沃克环流减弱。</p></div><div><h4>拉尼娜</h4><p>中东太平洋异常降温，沃克环流增强。</p></div></div>',
        },
      },
      {
        label: '时间线',
        hint: '竖向时间线（日期 + 事件），适合大事记、过程梳理。',
        icon: <IconTimeline />,
        el: {
          kind: 'box',
          variant: 'timeline',
          w: 509,
          h: 150,
          html: '<div class="w-timeline"><div class="item"><div class="date">2026.10</div><div class="text">超强厄尔尼诺形成，海温距平持续偏高。</div></div><div class="item"><div class="date">2026.12</div><div class="text">我国冬季风偏弱，出现暖冬概率增大。</div></div><div class="item"><div class="date">2027.06</div><div class="text">次年夏季雨带偏南，南涝北旱风险上升。</div></div></div>',
        },
      },
      {
        label: '表格',
        hint: '3 列表格，可双击单元格改字；适合知识点对比、数据整理。',
        icon: <IconTable />,
        el: {
          kind: 'box',
          variant: 'table',
          w: 509,
          h: 120,
          html:
            '<div class="w-table"><table><thead><tr><th></th><th></th><th></th></tr></thead><tbody><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></tbody></table></div>',
        },
      },
      {
        label: '公式',
        hint: '上下细线居中的公式、判定标准或定义。',
        icon: <IconFormula />,
        el: { kind: 'box', variant: 'formula', w: 509, h: 44, html: '<div class="w-formula">海温距平 = 实测海温 − 常年同期海温</div>' },
      },
    ],
  },
  {
    title: '版式 / 装饰',
    items: [
      {
        label: '本期导读',
        hint: '带边框的目录/导读，自动编号条目。',
        icon: <IconListOl />,
        el: {
          kind: 'box',
          variant: 'toc',
          w: 300,
          h: 160,
          html: '<div class="w-toc"><h4>本期导读</h4><ol><li>教材定位与考纲</li><li>厄尔尼诺必背知识</li><li>拉尼娜必背知识</li><li>答题模板与真题</li></ol></div>',
        },
      },
      {
        label: '编者按',
        hint: '虚线灰底编者按/旁白，适合放在栏目开头。',
        icon: <IconClipboard />,
        el: { kind: 'box', variant: 'editor-note', w: 509, h: 50, html: '<div class="w-editor-note">编者按：本期聚焦海—气相互作用与全球气候异常，建议先通读知识链，再完成配套习题。</div>' },
      },
      {
        label: '页边批注',
        hint: '黄色便签样式，适合补充提醒、教师批注。',
        icon: <IconSticky />,
        el: { kind: 'box', variant: 'margin-note', w: 220, h: 80, html: '<div class="w-margin-note">页边批注：注意区分“概率趋势”与“绝对化表述”。</div>' },
      },
      {
        label: '二维码框',
        hint: '二维码占位 + 扫码说明，适合放答案/PDF 链接。',
        icon: <IconQr />,
        el: {
          kind: 'box',
          variant: 'qr',
          w: 300,
          h: 80,
          html: '<div class="w-qr"><div class="code"></div><div class="text"><strong>扫码关注</strong><br>获取本期 PDF 与答案</div></div>',
        },
      },
      {
        label: '标签徽章',
        hint: '一排圆角标签（高考必考 / 湘教版 / 选择性必修1）。',
        icon: <IconTag />,
        el: { kind: 'box', variant: 'badges', w: 300, h: 30, html: '<div class="w-badges"><span>高考必考</span><span>湘教版</span><span>选择性必修1</span></div>' },
      },
      {
        label: '色块条',
        hint: '黑底白字整条标题，适合栏目分隔。',
        icon: <IconHeading />,
        el: { kind: 'box', variant: 'colorbar', w: 509, h: 30, html: '<div class="w-colorbar">本期核心 · 海气相互作用</div>' },
      },
      {
        label: '序号圆标',
        hint: '圆形序号（01 / 02），适合步骤、排行、栏目编号。',
        icon: <IconTag />,
        el: { kind: 'box', variant: 'numbadge', w: 40, h: 40, html: '<div class="w-numbadge">01</div>' },
      },
      {
        label: '双线分隔',
        hint: '双实线分隔，适合栏目之间。',
        icon: <IconMinus />,
        el: { kind: 'box', variant: 'rule-double', w: 509, h: 6, autoHeight: false, html: '<div class="w-rule-double"></div>' },
      },
      {
        label: '虚线分隔',
        hint: '虚线分隔，适合轻量分隔。',
        icon: <IconMinus />,
        el: { kind: 'box', variant: 'rule-dashed', w: 509, h: 4, autoHeight: false, html: '<div class="w-rule-dashed"></div>' },
      },
      {
        label: '点线分隔',
        hint: '点线分隔，适合报纸装饰。',
        icon: <IconMinus />,
        el: { kind: 'box', variant: 'rule-dotted', w: 509, h: 5, autoHeight: false, html: '<div class="w-rule-dotted"></div>' },
      },
    ],
  },
  {
    title: '其他',
    items: [
      {
        label: '姓名学号',
        hint: '姓名/学号填写行，带下划填写线。',
        icon: <IconIdCard />,
        el: { kind: 'box', variant: 'name-row', w: 300, h: 24, html: '<div class="name-row"><span>姓名：</span><span>学号：</span></div>' },
      },
      {
        label: '图片',
        hint: '拖入后选中它，在右侧属性面板填写图片地址（缺图自动占位）。',
        icon: <IconImage />,
        el: { kind: 'image', variant: 'image', w: 244, h: 140, src: '/images/img1.png' },
      },
      {
        label: '全屏背景',
        hint: '铺满整页的背景图，自动置于最底层、不参与避让，并对所有页生效；插入后点页面空白处选中它，再填图片地址。',
        icon: <IconImage />,
        el: { kind: 'image', variant: 'bg-image', w: 100, h: 100, src: '', background: true },
      },
      {
        label: '分隔线',
        hint: '水平实线，可拉宽拉窄、改颜色。',
        icon: <IconMinus />,
        el: { kind: 'line', variant: 'line', w: 509, h: 2, html: '' },
      },
      {
        label: '报头',
        hint: '报纸报头/大标题横幅：期刊名、主标题、副标题。加到页面顶部、页眉下方，可单独调内部标题。',
        icon: <IconTitle />,
        el: {
          kind: 'chrome',
          variant: 'masthead',
          w: 1031.8,
          h: 86.6,
          html: '<div class="masthead"><div class="kicker">期刊一</div><h1>超强厄尔尼诺已经形成</h1><div class="sub">海—气相互作用 · 全球气候异常 · 高考必考</div></div>',
        },
      },
      {
        label: '页眉',
        hint: '页面顶部的页眉：左侧刊名/英文名，右侧期数/日期。加到当前页顶部，可改内容、字号、线宽。',
        icon: <IconHeading />,
        el: {
          kind: 'chrome',
          variant: 'header',
          w: 1031.8,
          h: 34.8,
          html: '<div class="header"><div class="header-left"><div class="header-title">地理时政周刊 <span>GEO WEEKLY</span></div></div><div class="header-right"><div class="issue">第一期</div><div>2026.10.25</div></div></div>',
        },
      },
      {
        label: '页脚',
        hint: '页面底部的页脚：左边标语、中间自动页码、右边编辑/核对。加到当前页底部，改字号/线宽/内容都可。',
        icon: <IconClipboard />,
        el: {
          kind: 'chrome',
          variant: 'footer',
          w: 1031.8,
          h: 31,
          html: '<div class="footer"><div class="footer-top"><span>尺幅千里，卷纳乾坤</span><span class="center">— 1 / 2 —</span><span>思接寰宇，笔绘山河</span></div><div class="footer-bottom"><span>地理限时训练</span><span>使用日期：2026年10月26日</span><span>编辑：曹明环</span><span>核对：何文静</span></div></div>',
        },
      },
      {
        label: '限制区域',
        hint: '约束容器（区域）：元素落入区域后拖动/缩放都不会出区域；区域永远在最底层。也可用画布工具条「▭ 框选区域」按网格画。',
        icon: <IconRegion />,
        el: { kind: 'region', variant: 'region', w: 320, h: 160, label: '区域' },
      },
    ],
  },
]

const TOTAL = GROUPS.reduce((s, g) => s + g.items.length, 0)

/** 常用区由“实际使用过的组件”动态生成；这些组件仍保留在各自分组里 */
const ALL_ITEMS = GROUPS.flatMap((g) => g.items)
const FREQUENT_KEY = 'paiban-frequent-components'
const FREQUENT_LIMIT = 12

export function Palette({ api }: { api: EditorApi }) {
  const [query, setQuery] = useState('')
  const [cols, setCols] = useState<4 | 5>(4)
  const [frequent, setFrequent] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(FREQUENT_KEY) || '[]')
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, FREQUENT_LIMIT) : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(FREQUENT_KEY, JSON.stringify(frequent))
    } catch {
      /* 本地存储不可用 */
    }
  }, [frequent])

  const useItem = (label: string) => {
    // 已存在则保持原位置；新用到的放到最前面；超过 12 个踢掉最后一个
    setFrequent((prev) => {
      if (prev.includes(label)) return prev
      return [label, ...prev].slice(0, FREQUENT_LIMIT)
    })
  }

  const selected = api.selection ? api.findEl(api.selection) : null
  const selectedVariant = selected?.variant
  const frequentItems = frequent.map((label) => ALL_ITEMS.find((i) => i.label === label)).filter((x): x is PaletteItem => !!x)
  const q = query.trim().toLowerCase()
  const filtered = q ? ALL_ITEMS.filter((it) => `${it.label}${it.hint}`.toLowerCase().includes(q)) : []
  const searching = q.length > 0

  const add = (item: PaletteItem) => {
    useItem(item.label)
    if (item.el.variant === 'bg-image') {
      // 全屏背景：铺满所有页，自动置底
      api.setPageBackground(item.el.src ?? '')
      return
    }
    const page = api.pageIdx
    if (item.el.variant === 'footer') {
      const margin = 45.3
      api.addEl(page, { ...item.el, x: margin, y: api.doc.h - 60.5, w: api.doc.w - margin * 2 })
      return
    }
    if (item.el.variant === 'header') {
      const margin = 45.3
      api.addEl(page, { ...item.el, x: margin, y: 37.8, w: api.doc.w - margin * 2 })
      return
    }
    if (item.el.variant === 'masthead') {
      const margin = 45.3
      const header = api.doc.pages[page]?.els.find((e) => e.variant === 'header')
      const y = header ? header.y + header.h + 8 : 80.6
      api.addEl(page, { ...item.el, x: margin, y, w: api.doc.w - margin * 2 })
      return
    }
    const x = Math.round((api.doc.w - item.el.w) / 2)
    const y = Math.round((api.doc.h - item.el.h) / 2)
    // addEl 内部负责：版心约束 → 把重叠内容下推 → 自动高度/分页
    api.addEl(page, { ...item.el, x, y })
  }

  const itemNode = (item: PaletteItem) => (
    <div
      key={item.label}
      className={`ed-palette-item${selectedVariant === item.el.variant ? ' is-selected-component' : ''}`}
      data-label={item.label}
      data-variant={item.el.variant}
      draggable
      onDragStart={(e) => {
        useItem(item.label)
        e.dataTransfer.setData('application/x-paiban-component', JSON.stringify(item.el))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => add(item)}
      data-tip={`<b>${item.label}</b>${item.hint}<br/>拖到页面可自由落位，点击则加到页面中央`}
      data-tip-pos="right"
      title={item.label}
    >
      <span className="ed-pi-icon">{item.icon}</span>
      <span className="ed-pi-label">{item.label}</span>
    </div>
  )

  const groupNode = (title: string, items: PaletteItem[], emptyText?: string) => (
    <div key={title} className="ed-palette-group">
      <div className="ed-palette-group-title">
        <span>{title}</span>
        <em>{items.length}</em>
      </div>
      {items.length ? <div className="ed-palette-grid">{items.map(itemNode)}</div> : emptyText ? <div className="ed-palette-empty ed-palette-empty-sm">{emptyText}</div> : null}
    </div>
  )

  return (
    <div className="ed-palette" data-cols={cols}>
      <div className="ed-palette-head">
        <span className="ed-palette-title">组件库 · {TOTAL} 种</span>
        <div className="ed-palette-cols" role="group" aria-label="每行组件数量">
          {([4, 5] as const).map((n) => (
            <button key={n} className={cols === n ? 'is-on' : ''} onClick={() => setCols(n)} title={`每行 ${n} 个`}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="ed-palette-search">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索组件：表格 / 时间线 / 导语…"
          aria-label="搜索组件"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="清空搜索">
            ×
          </button>
        )}
      </div>
      <div className="ed-palette-list">
        {searching ? (
          filtered.length ? (
            groupNode(`搜索结果 · ${filtered.length}`, filtered)
          ) : (
            <div className="ed-palette-empty">没有匹配的组件</div>
          )
        ) : (
          <>
            {groupNode('常用', frequentItems, '使用任意组件后会自动出现在这里')}
            {GROUPS.map((group) => groupNode(group.title, group.items))}
          </>
        )}
      </div>
    </div>
  )
}
