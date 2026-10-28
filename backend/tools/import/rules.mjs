/**
 * 规则表：blocks → 组件元素
 *
 * 设计原则
 * - 字号只作层级信号，不改写成具体样式（样式由变体 CSS 决定）
 * - 语义判断优先用「章节上下文 + 关键词」，其次用行内模式
 * - 连续段落要归并成一个组件时（答题模板、选择题、姓名行），用显式分组
 * - 所有生成结果都是编辑器已有的变体，不引入新组件类型
 */

/* ------------------------------------------------------------------ *
 * 文本工具
 * ------------------------------------------------------------------ */

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const plain = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

/** 按字符数把 runs 切成两段，尽量不拆断加粗 */
export function splitRuns(runs, n) {
  const head = []
  const tail = []
  let used = 0
  for (const r of runs) {
    if (used >= n) {
      tail.push(r)
      continue
    }
    const room = n - used
    if (r.text.length <= room) {
      head.push(r)
      used += r.text.length
    } else {
      head.push({ ...r, text: r.text.slice(0, room) })
      tail.push({ ...r, text: r.text.slice(room) })
      used = n
    }
  }
  return [head, tail]
}

/** 页码域 / 分节域代码，textutil 会原样吐出来，必须丢掉 */
const isFieldCode = (t) => /(=\s*(PAGE|NUMPAGES|SECTIONPAGES)\b|\bMERGEFORMAT\b)/i.test(t)

/* ------------------------------------------------------------------ *
 * 元信息抽取：页眉 / 页脚 / 刊名
 * ------------------------------------------------------------------ */

export function extractMeta(blocks) {
  const meta = {
    journal: '',
    en: 'GEO WEEKLY',
    issue: '',
    date: '',
    sloganLeft: '',
    sloganRight: '',
    useDate: '',
    editor: '',
    proofreader: '',
  }

  for (const b of blocks) {
    const t = b.text
    if (!t) continue

    if (!meta.sloganLeft && /卷纳乾坤|思接寰宇|笔绘山河/.test(t)) {
      // 原稿常把口号和「使用日期 / 编辑 / 核对」挤在同一行，先切掉元信息再取口号
      const head = t.replace(/使用日期[：:].*$/, '').replace(/编辑[：:].*$/, '').replace(/核对[：:].*$/, '').trim()
      const cut = head.search(/思接寰宇|笔绘山河/)
      if (cut > 0) {
        meta.sloganLeft = head.slice(0, cut).trim()
        meta.sloganRight = head.slice(cut).trim()
      } else if (head) {
        meta.sloganLeft = head
      }
    }

    const d = /使用日期[：:]\s*([0-9]{4}\s*年\s*[0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日)/.exec(t)
    if (d) meta.useDate = d[1].replace(/\s+/g, '')
    const ed = /编辑[：:]\s*([\u4e00-\u9fa5·]{2,10})/.exec(t)
    if (ed) meta.editor = ed[1]
    const pf = /(?:核对|校对)[：:]\s*([\u4e00-\u9fa5·]{2,10})/.exec(t)
    if (pf) meta.proofreader = pf[1]

    const bare = t.replace(/[一二三四五六七八九十\d]+\s*$/, '')
    if (!meta.journal && /(周刊|周报|日报|月报)$/.test(bare) && bare.length <= 10) meta.journal = bare

    const issue = /(?:期刊|第)\s*([一二三四五六七八九十\d]+)/.exec(t)
    if (!meta.issue && issue) meta.issue = `第${issue[1]}期`
  }

  return meta
}

/* ------------------------------------------------------------------ *
 * 单段打标签
 * ------------------------------------------------------------------ */

const RE_SECTION = /^([一二三四五六七八九十]+)\s*[、.．]\s*(.+)$/
/** 纯文本稿的中文数字章节：`五 高考重难点`（空格分隔，没有顿号） */
const RE_SECTION_LOOSE = /^([一二三四五六七八九十]+)\s*[、.．,，:：\s]\s*(.+)$/
const RE_H3 = /^(\d+)\s*[.、．]\s*(.+)$/
const RE_OPTION = /^([A-D])\s*[.、．]\s*(.+)$/
const RE_ANSWER = /^(?:标准)?答案\s*[：:]?\s*(.*)$/
const RE_EXPLAIN = /^解\s*析\s*[：:]\s*(.*)$/
const RE_TPL_TITLE = /^【(.+?)】$/
const RE_QUESTION_NO = /^[（(](\d+)[）)]\s*(.+)$/
const RE_LABEL = /^([^：:]{1,12})[：:]\s*(.+)$/
const RE_LABEL_GT = /^[>＞]\s*([^：:]{1,12})[：:]\s*(.+)$/

/** 整段加粗时保留为独立小标题的词，不参与「栏目标签合并」 */
const H3_KEYWORDS =
  /^(必考能力|核心能力|核心素养|高考命题趋势|教材核心定义|知识梳理|方法点拨|易错提醒|答题思路|本期学习要求|学习要求)$/

const TRAP_WORDS = /(切忌|易错|误区|杜绝|不可写|不能写|而不是|不是单纯|并非|极易|陷阱)/
const NOTE_WORDS = /(核心考点|本节要点|重点关注|需要特别注意|命题人常)/
const CONCEPT_CTX = /核心定义|概念|名词解释/
const REQ_CTX = /学习要求|训练要求|作业要求|本期要求/
const TRAP_CTX = /易错|误区|重难点|高频坑/
const NOTE_CTX = /衔接|升华|总结|编者按/

/** 段落字号分级：textutil 用 16px 表一级、15px 表二级、11px 表正文 */
const SIZE_L1 = 15.6
const SIZE_L2 = 13.5

/* ------------------------------------------------------------------ *
 * 纯文本稿（无格式）兜底
 *
 * 从微信 / 网页复制到 Word 再保存的原稿，全篇只有一种字号、没有加粗，
 * 靠字号判断层级的整套规则会全部失效（所有东西都变成正文）。
 * 这类稿子的层级信号只剩「文字形态」：中文数字编号、编号小标题、
 * 【模板】、✕、A./B./C./D. 选项、短标题行。
 * 探测到这种稿子就切到 textMode，改用文字形态判断。
 * ------------------------------------------------------------------ */

/** 章节级关键词：出现这些词的无标点短行按一级章节处理 */
const SECTION_WORDS =
  /(教材定位|考纲|主干知识|必背|重难点|易错|答题模板|模板背诵|时政.*衔接|衔接|学习要求|训练要求|配套习题|课后习题|知识梳理|本期导读)/

/** 明确不是章节的短行（属于小节） */
const SUBHEAD_WORDS =
  /^(必考能力|核心能力|核心素养|高考命题趋势|命题趋势|专家分析|导读|小结|教材核心概念|核心概念|知识清单)$/

/**
 * 判断整篇是否「无格式纯文本稿」：字号层次几乎不存在，且几乎没有加粗。
 * 只要原稿带正常的标题字号或加粗，就不启用，保持原有行为。
 */
export function isPlainTextDoc(blocks = []) {
  const real = blocks.filter((b) => !b.empty && b.text && !isFieldCode(b.text))
  if (real.length < 6) return false
  const sizes = new Set(real.map((b) => Math.round((b.fontSize || 0) * 10) / 10))
  const boldCount = real.filter((b) => b.bold).length
  return sizes.size <= 2 && boldCount <= Math.max(1, real.length * 0.05)
}

/** 纯文本稿里的杂质行：页码、页脚署名、末尾操作提示 */
const isPlainNoise = (t) =>
  /^[—–\-－]\s*\d+\s*[/／]\s*\d+\s*[—–\-－]$/.test(t) ||
  /^(编辑|核对|校对|使用日期|排版|制版)\s*[：:]/.test(t) ||
  /^(复制|粘贴|另存|保存)全部|粘贴到\s*Word|保存为\s*PDF|直接保存为/.test(t) ||
  (/^(地理时政周刊|GEO WEEKLY)/i.test(t) && t.length < 30)

/** 短标题行：没有句读、不超过 24 字 */
const isShortTitle = (t) => t.length <= 24 && !/[。；，,;!?！？]/.test(t)

/** 取标题的主干：`配套习题 · 选择题` → `配套习题` */
const stemOf = (t) => String(t).split(/[·・|｜—–]/)[0].replace(/[\s（(].*$/, '').trim()

/**
 * 章节标题统一成参考稿的写法：
 *   `厄尔尼诺 必背主干知识`   → `厄尔尼诺 · 必背主干知识`
 *   `高考重难点+高频易错坑`   → `高考重难点 + 高频易错坑`
 *   `高考考纲&命题能力要求`   → `高考考纲 & 命题能力要求`
 * 已经是 · 连接的保持不动（避免 `A · B` 变成 `A · · B`）。
 */
function formatSectionTitle(t) {
  let s = String(t ?? '').trim()
  s = s.replace(/\s*&\s*/g, ' & ')
  s = s.replace(/\s*\+\s*/g, ' + ')
  s = s.replace(/(?<=[^\s·&+])\s+(?=[^\s·&+])/g, ' · ')
  return s
}

/** 1 → 一，12 → 十二（章节编号最多到二十） */
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
export function cnt(n) {
  if (n <= 10) return CN[n]
  if (n < 20) return '十' + CN[n - 10]
  if (n === 20) return '二十'
  return String(n)
}

/** 原文自带的行首编号（①、1.、（1）、一、），生成组件时要剥掉，否则会和自动编号重复 */
const RE_LEAD_NO =
  /^\s*(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮]|\d{1,2}\s*[.、．)）]|[一二三四五六七八九十]{1,2}\s*[、.．]|[（(]\s*\d{1,2}\s*[）)])\s*/
export const stripLead = (html) => String(html).replace(RE_LEAD_NO, '')

/** 易错项：原文的 ✕ 由组件样式统一画，正文里要去掉，否则出现两个叉 */
export const stripTrapMark = (html) => String(html).replace(/^\s*[✕×✗xX]\s*/, '')

/* ------------------------------------------------------------------ *
 * 短条目合并规则（可在导入时用「合并/拆分」开关覆盖）
 * ------------------------------------------------------------------ */

/**
 * 参与合并的变体：都是「一条一句」的短列表，合并后观感与拆开一致，
 * 但整组只占一个组件，不会被分栏/分页切成两半。
 */
const MERGE_VARIANTS = new Set(['req', 'circle', 'trap'])

/** 单条最长字符数：超过就当作整段，不并入组 */
const MERGE_MAX_CHARS = 52

/** 一组最多合并几条，太多就退回拆分（否则一个组件过高，反而更难排版） */
const MERGE_MAX_ITEMS = 6

/** 组上方的同类小标题一并带走，避免「本期学习要求」和它的 3 条被分到两页 */
const MERGE_HEADING = /^(本期)?(学习|训练|作业|复习)?要求$|^(必考能力|核心能力|核心素养|易错提醒|易错点)$/

const isShortItem = (el) => plain(el.html).length <= MERGE_MAX_CHARS

/**
 * @param {Array} blocks
 * @param {{plainText?: boolean}} [opts] plainText 强制按纯文本稿处理
 */
/**
 * 「配套习题 / 配套高考真题变式习题（含标准答案）」这种帽子要不要吞掉。
 * 只有紧跟着的下一段确实是「一、选择题」这类子标题时才吞，
 * 否则照常出条——宁可多一条标题，也不能把标题吃了。
 * @returns {boolean} true 表示已吞掉（调用方应 continue）
 */
function makeExerciseHatSwallower(blocks) {
  return (titleRaw, bi) => {
    if (!/配套/.test(titleRaw) || !/习题/.test(titleRaw)) return false
    for (let j = bi + 1; j < blocks.length; j++) {
      const nb = blocks[j]
      if (nb.empty || !nb.text || isFieldCode(nb.text)) continue
      return /^[一二三四五六七八九十]+\s*[、.．]\s*(选择题|综合大题|非选择题|材料题|填空题|判断题|简答题)\s*(?:[（(][^）)]*[）)])?\s*$/.test(nb.text)
    }
    return false
  }
}

export function tagBlocks(blocks, opts = {}) {
  const out = []
  let sectionTitle = ''
  let h3Title = ''
  let circleList = false
  const textMode = opts?.plainText ?? isPlainTextDoc(blocks)
  let secNo = 0
  /**
   * 「配套习题」是个大帽子，它的实际内容一律是「一、选择题 / 二、综合大题」。
   * 参考稿里这个帽子本身不单独成条，而是直接写成
   *     ■ 配套习题 · 选择题      ■ 配套习题 · 综合大题
   * 两条同级章节。所以遇到这种帽子先不 push，记住 stem，等子标题来了再一起出。
   */
  let exerciseStem = ''
  /** 帽子判断：是「配套习题」且下一段是选择题/大题子标题 → 吞掉帽子，等子标题出条 */
  const shouldSwallow = makeExerciseHatSwallower(blocks)
  const swallowExerciseHat = (titleRaw, bi) => {
    if (!shouldSwallow(titleRaw, bi)) return false
    exerciseStem = '配套习题'
    sectionTitle = titleRaw
    h3Title = ''
    return true
  }

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi]
    if (b.empty) continue
    const t = b.text
    if (!t) continue
    if (isFieldCode(t)) continue
    if (textMode && isPlainNoise(t)) continue

    const resetList = () => {
      circleList = false
    }

    /* 配套习题帽子下的子标题：`一、选择题` / `二、综合大题` → 同级章节条「配套习题 · 选择题」 */
    if (exerciseStem) {
      const ex = /^[一二三四五六七八九十]+\s*[、.．]\s*(选择题|综合大题|非选择题|材料题|填空题|判断题|简答题)\s*(?:[（(][^）)]*[）)])?\s*$/.exec(t)
      if (ex) {
        secNo += 1
        sectionTitle = `${exerciseStem} · ${ex[1]}`
        h3Title = ''
        resetList()
        out.push({ b, tag: 'section', extra: { num: cnt(secNo), title: sectionTitle } })
        continue
      }
    }

    /* 纯文本稿：中文数字（或空格分隔）的短行 → 一级章节，编号按出现顺序重排 */
    if (textMode) {
      const loose = RE_SECTION_LOOSE.exec(t)
      if (loose && t.length <= 40 && isShortTitle(loose[2])) {
        const titleRaw = loose[2].trim()
        if (swallowExerciseHat(titleRaw, bi)) continue
        exerciseStem = ''
        secNo += 1
        sectionTitle = formatSectionTitle(titleRaw)
        h3Title = ''
        resetList()
        out.push({ b, tag: 'section', extra: { num: cnt(secNo), title: sectionTitle } })
        continue
      }
      /* 与当前章节同主题的续接行（`配套习题 · 综合大题` 接 `配套习题 · 选择题`）→ 降为小标题 */
      if (textMode && isShortTitle(t) && t.length <= 22 && sectionTitle && stemOf(t) === stemOf(sectionTitle)) {
        h3Title = t
        resetList()
        out.push({ b, tag: 'h3', extra: { title: t }, plain: true })
        continue
      }

      /* 丢掉原编号后仍是章节：`平陆运河 · 必背主干知识`、`本期学习要求`
         必须以「非编号」开头，否则会把 `2.建设区位条件(必背逻辑链)` 这类小标题误升成章节 */
      if (
        isShortTitle(t) &&
        t.length <= 22 &&
        !SUBHEAD_WORDS.test(t) &&
        !RE_H3.test(t) &&
        !RE_SECTION_LOOSE.test(t) &&
        SECTION_WORDS.test(t)
      ) {
        secNo += 1
        sectionTitle = t.trim()
        h3Title = ''
        resetList()
        out.push({ b, tag: 'section', extra: { num: cnt(secNo), title: sectionTitle } })
        continue
      }
    }

    /* 一级标题：一、教材定位（靠字号和二级区分：16px vs 15px） */
    const sec = RE_SECTION.exec(t) || (textMode ? RE_SECTION_LOOSE.exec(t) : null)
    if (sec && t.length <= 40) {
      if (textMode || b.fontSize >= SIZE_L1) {
        const titleRaw = sec[2].trim()
        if (swallowExerciseHat(titleRaw, bi)) continue
        exerciseStem = ''
        secNo += 1
        sectionTitle = formatSectionTitle(titleRaw)
        h3Title = ''
        resetList()
        out.push({ b, tag: 'section', extra: { num: textMode ? cnt(secNo) : sec[1], title: sectionTitle } })
      } else {
        h3Title = t
        resetList()
        out.push({ b, tag: 'h3', extra: { num: sec[1], title: sec[2].trim() }, numbered: true })
      }
      continue
    }

    /* 模板标题：【厄尔尼诺专属答题模板】 */
    const tpl = RE_TPL_TITLE.exec(t)
    if (tpl) {
      resetList()
      out.push({ b, tag: 'tpltitle', extra: { title: tpl[1] } })
      continue
    }

    /* 选择题选项（必须早于小标题判断，否则 `A.加剧水土流失` 会被当成小标题） */
    const opt = RE_OPTION.exec(t)
    if (opt && t.length <= 80) {
      resetList()
      out.push({ b, tag: 'option', extra: { key: opt[1], text: opt[2].trim() } })
      continue
    }

    /* 二级标题：1. 定义与判定 */
    const h3 = RE_H3.exec(t)
    if (h3 && (b.fontSize >= SIZE_L2 || textMode) && !/[。；]/.test(t) && (!textMode || isShortTitle(h3[2]))) {
      h3Title = t
      resetList()
      out.push({ b, tag: 'h3', extra: { num: h3[1], title: h3[2].trim() }, numbered: true })
      continue
    }

    /*
     * 无编号的章节行：`本期学习要求`。
     * 必须排在上面那几个判断之后 —— 否则 `一、教材定位`、`2. 形成机理`、`【答题模板】`
     * 都会被 SECTION_WORDS 抓住，升成章节条，编号也跟着重复。
     */
    if (!textMode && !RE_SECTION.test(t) && !RE_H3.test(t) && !/^[【\[]/.test(t) && !/^[A-D]\s*[.、．]/.test(t)) {
      if (isShortTitle(t) && t.length <= 22 && !SUBHEAD_WORDS.test(t) && SECTION_WORDS.test(t)) {
        const titleRaw = t.trim()
        if (!swallowExerciseHat(titleRaw, bi)) {
          exerciseStem = ''
          secNo += 1
          sectionTitle = formatSectionTitle(titleRaw)
          h3Title = ''
          resetList()
          out.push({ b, tag: 'section', extra: { num: cnt(secNo), title: sectionTitle } })
        }
        continue
      }
    }

    /* 纯文本稿的无编号小标题：必考能力 / 教材核心概念 / 高考命题趋势 */
    if (textMode && !/[：:]/.test(t) && (SUBHEAD_WORDS.test(t) || (t.length <= 12 && isShortTitle(t)))) {
      h3Title = t
      resetList()
      out.push({ b, tag: 'h3', extra: { title: t }, plain: true })
      if (/必考能力|核心能力/.test(t)) circleList = true
      continue
    }

    if (RE_ANSWER.test(t)) {
      out.push({ b, tag: 'answer', extra: { text: (RE_ANSWER.exec(t)?.[1] ?? '').trim() } })
      continue
    }
    if (RE_EXPLAIN.test(t)) {
      out.push({ b, tag: 'explain', extra: { text: (RE_EXPLAIN.exec(t)?.[1] ?? '').trim() } })
      continue
    }

    /* 综合大题小问：（1）简述……（6分） */
    const qn = RE_QUESTION_NO.exec(t)
    if (qn && /[（(]\s*\d+\s*分\s*[）)]|简述|分析|说明|指出|比较|评价|描述/.test(t)) {
      resetList()
      out.push({ b, tag: 'question', extra: { num: qn[1], text: t } })
      continue
    }

    /* 姓名 / 学号 行 */
    if (/^(姓名|学号|班级)\s*[：:]/.test(t)) {
      out.push({ b, tag: 'name', extra: { text: t } })
      continue
    }

    /* `>对接教材：…` */
    const gt = RE_LABEL_GT.exec(t)
    if (gt) {
      out.push({ b, tag: 'label', extra: { name: gt[1], rest: gt[2] } })
      continue
    }

    /* 逻辑链：三个以上箭头 */
    if ((t.match(/→|—>|➜/g) || []).length >= 3) {
      resetList()
      out.push({ b, tag: 'chain' })
      continue
    }

    /* 整段加粗的短句：先判，避免被下面的圈号列表吞掉 */
    if (b.bold && t.length <= 22 && !/[。；]/.test(t)) {
      const title = t.replace(/[：:]\s*$/, '').trim()
      if (H3_KEYWORDS.test(title)) {
        h3Title = title
        resetList()
        out.push({ b, tag: 'h3', extra: { title }, plain: true })
        if (/必考能力|核心能力/.test(title)) circleList = true
        continue
      }
      // 非关键词的加粗短标题：可能是「太平洋东岸（秘鲁、厄瓜多尔）」这类栏目词，
      // 交给 groupBlocks 判断能否与紧随的段落合并成「标签段」
      out.push({ b, tag: 'mergehead', extra: { title } })
      continue
    }

    /* 「必考能力」下的连续条目：加圈号，不参与其它判断 */
    if (circleList && t.length < 60 && !/[。]$/.test(t)) {
      out.push({ b, tag: 'circle' })
      continue
    }
    circleList = false

    /* 学习要求类章节：条目编号 */
    if (REQ_CTX.test(sectionTitle + h3Title)) {
      resetList()
      out.push({ b, tag: 'req' })
      continue
    }

    /* 易错项：章节上下文优先，其次行首叉号，再次关键词 */
    if (
      TRAP_CTX.test(sectionTitle) ||
      /^[✕×✗]/.test(t) ||
      (TRAP_WORDS.test(t) && t.length < 120 && !/^[（(]/.test(t))
    ) {
      out.push({ b, tag: 'trap' })
      continue
    }

    /* 名词解释：核心定义章节下的「名词：解释」 */
    const label = RE_LABEL.exec(t)
    if (label && CONCEPT_CTX.test(h3Title + sectionTitle) && label[1].length <= 12 && label[2].length > 6) {
      out.push({ b, tag: 'concept', extra: { name: label[1], rest: label[2] } })
      continue
    }

    /* 注释框 */
    if ((NOTE_WORDS.test(t) && t.length > 40) || (NOTE_CTX.test(sectionTitle) && t.length > 40)) {
      out.push({ b, tag: 'note' })
      continue
    }

    /* 冒号开头的短标签段 */
    if (label && label[1].length <= 10) {
      out.push({ b, tag: 'label', extra: { name: label[1], rest: label[2] } })
      continue
    }

    out.push({ b, tag: 'para' })
  }

  // 让「本期学习要求」这类标题下的正文也被正确处理：把紧邻 req 段之前的普通段一并标为 req
  return out
}

/* ------------------------------------------------------------------ *
 * 组件 HTML 模板（与 Palette 里的变体保持一致）
 * ------------------------------------------------------------------ */

const H = {
  section: (num, title) => `<div class="section-title"><span class="num">${esc(num)}</span><h2>${esc(title)}</h2></div>`,
  h3: (title) => `<h3>${title}</h3>`,
  para: (html) => `<p>${html}</p>`,
  label: (name, restHtml) => `<p><span class="label">${esc(name)}：</span>${restHtml}</p>`,
  note: (html) => `<div class="note">${html}</div>`,
  concept: (name, restHtml) => `<div class="concept-box"><span class="name">${esc(name)}：</span>${restHtml}</div>`,
  trap: (html) => `<div class="trap"><span class="x">✕</span><span class="t">${html}</span></div>`,
  req: (html) => `<div class="req">${html}</div>`,
  chain: (text) =>
    `<div class="chain">${text
      .split(/→|—>|➜/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `<span class="node">${esc(s)}</span>`)
      .join('<span class="arrow">→</span>')}</div>`,
  tpl: (title, inner) => `<div class="tpl"><h4>【${esc(title)}】</h4>${inner}</div>`,
  quiz: (inner) => `<div class="quiz">${inner}</div>`,
  nameRow: () => '<div class="name-row"><span>姓名：</span><span>学号：</span></div>',
  image: (src, ratio) =>
    `<div class="img-ph" style="--img-ratio:${ratio.toFixed(3)}">${
      src ? `<img src="${esc(src)}" alt="原稿配图">` : '<span class="ph">配图占位 · 双击选择本地图片</span>'
    }</div>`,
}

const EL = {
  section: (html) => ({ kind: 'chrome', variant: 'section-title', html }),
  subhead: (html) => ({ kind: 'text', variant: 'subhead', html }),
  paragraph: (html) => ({ kind: 'text', variant: 'paragraph', html }),
  note: (html) => ({ kind: 'box', variant: 'note', html }),
  concept: (html) => ({ kind: 'box', variant: 'concept', html }),
  trap: (html) => ({ kind: 'box', variant: 'trap', html }),
  req: (html) => ({ kind: 'text', variant: 'req', html }),
  chain: (html) => ({ kind: 'box', variant: 'chain', html }),
  tpl: (html) => ({ kind: 'box', variant: 'tpl', html }),
  quiz: (html) => ({ kind: 'box', variant: 'quiz', html }),
  nameRow: (html) => ({ kind: 'box', variant: 'name-row', html }),
  image: (html) => ({ kind: 'image', variant: 'image', html }),
}

/* ------------------------------------------------------------------ *
 * 归并成组件
 * ------------------------------------------------------------------ */

const isBreakTag = (t) => t === 'section' || t === 'tpltitle' || t === 'question'

export function groupBlocks(tagged, warnings = [], opts = {}) {
  /** 综合大题每框的目标字数：越小切得越碎、越好填缝，但框边距也越多 */
  const quizSplit = opts.quizSplit ?? 420
  const elements = []
  let i = 0
  let quizNo = 0
  let reqNo = 0
  let circleNo = 0
  let prevTag = ''

  const push = (el) => elements.push(el)

  while (i < tagged.length) {
    const cur = tagged[i]
    if (cur.tag !== 'req') reqNo = 0
    if (cur.tag !== 'circle') circleNo = 0

    /* —— 选择题：题干 + A/B/C/D + 答案 + 解析 —— */
    if (cur.tag === 'option' && cur.extra.key === 'A') {
      const stemEl = elements.pop()
      const stemHtml = stemEl ? stripLead(stemEl.html.replace(/^<p>/, '').replace(/<\/p>$/, '')) : ''
      const opts = []
      let j = i
      while (j < tagged.length && tagged[j].tag === 'option') {
        opts.push(tagged[j].extra)
        j++
      }
      let ans = ''
      let exp = ''
      while (j < tagged.length && (tagged[j].tag === 'answer' || tagged[j].tag === 'explain')) {
        if (tagged[j].tag === 'answer') ans = tagged[j].extra.text || plain(tagged[j].b.html)
        else exp = tagged[j].extra.text || plain(tagged[j].b.html)
        j++
      }
      quizNo += 1
      const inner =
        `<p><strong>${quizNo}. ${stemHtml}</strong></p>` +
        `<p>${opts.map((o) => `${o.key}. ${esc(o.text)}`).join('<br>')}</p>` +
        (ans || exp
          ? `<p>${ans ? `<span class="ans">答案：${esc(ans)}</span>` : ''}${
              exp ? ` <span class="exp">解析：${esc(exp)}</span>` : ''
            }</p>`
          : '')
      push(EL.quiz(H.quiz(inner)))
      prevTag = 'quiz'
      i = j
      continue
    }

    /* —— 综合大题：材料 + （1）（2）（3）… 每个小问单独成框，便于跨栏/跨页 —— */
    if (cur.tag === 'question') {
      const lead = []
      // 回吞紧邻的「阅读材料…」段，让它成为第一小问的材料
      while (elements.length) {
        const last = elements[elements.length - 1]
        if (last.variant !== 'paragraph') break
        const txt = plain(last.html)
        if (/^(阅读材料|阅读图文|材料[：:]|材料$)/.test(txt) || txt.length < 90) {
          lead.unshift(`<p>${last.html.replace(/^<p>/, '').replace(/<\/p>$/, '')}</p>`)
          elements.pop()
          continue
        }
        break
      }
      let first = true
      let group = []
      while (i < tagged.length && tagged[i].tag === 'question') {
        const owner = first ? [...lead] : []
        first = false
        owner.push(`<p><strong>${esc(tagged[i].extra.text)}</strong></p>`)
        i++
        // 「标准答案」这几个字单独成段，作为下一段的前缀标记；
        // 若答案正文就在同一段里，必须原样收进来，否则整段答案会丢
        let answerMark = false
        while (i < tagged.length && tagged[i].tag === 'answer') {
          const txt = (tagged[i].extra?.text ?? '').trim()
          if (txt) owner.push(`<p><span class="ans">标准答案：</span>${esc(txt)}</p>`)
          else answerMark = true
          i++
        }
        while (i < tagged.length && tagged[i].tag !== 'question' && !isBreakTag(tagged[i].tag)) {
          const t = tagged[i]
          if (t.tag === 'h3' || t.tag === 'option') break
          if (t.tag === 'answer') {
            const txt = (t.extra?.text ?? '').trim()
            if (txt) owner.push(`<p><span class="ans">标准答案：</span>${esc(txt)}</p>`)
            else answerMark = true
          } else {
            const prefix = answerMark ? '<span class="ans">标准答案：</span>' : ''
            owner.push(`<p>${prefix}${t.b.html}</p>`)
            answerMark = false
          }
          i++
        }
        group.push(...owner)
        // 单个框太高会整块翻页、把前一页留空，超长就提前切一刀
        if (group.join('').replace(/<[^>]+>/g, '').length > quizSplit) {
          push(EL.quiz(H.quiz(group.join(''))))
          group = []
        }
      }
      if (group.length) push(EL.quiz(H.quiz(group.join(''))))
      prevTag = 'quiz'
      continue
    }

    /* —— 答题模板：【x模板】+ 条目 —— */
    if (cur.tag === 'tpltitle') {
      const title = cur.extra.title
      const inner = []
      let j = i + 1
      while (j < tagged.length) {
        const t = tagged[j]
        if (isBreakTag(t.tag) || t.tag === 'option' || t.tag === 'name') break
        if (t.tag === 'h3' && t.b.fontSize >= SIZE_L2) break
        if (t.tag === 'mergehead') {
          const next = tagged[j + 1]
          if (next && next.tag === 'para') {
            inner.push(`<p><span class="label">${esc(t.extra.title)}：</span>${next.b.html}</p>`)
            j += 2
            continue
          }
          inner.push(`<p><b>${esc(t.extra.title)}</b></p>`)
          j++
          continue
        }
        const lb = t.extra?.name ?? RE_LABEL.exec(t.b.text)?.[1]
        const rest = t.extra?.rest ?? RE_LABEL.exec(t.b.text)?.[2]
        if ((t.tag === 'label' || lb) && rest) inner.push(`<p><span class="label">${esc(lb)}：</span>${esc(rest)}</p>`)
        else if (t.tag !== 'trap') inner.push(`<p>${t.b.html}</p>`)
        j++
      }
      push(EL.tpl(H.tpl(title, inner.join(''))))
      prevTag = 'tpl'
      i = j
      continue
    }

    /* —— 姓名 / 学号 —— */
    if (cur.tag === 'name') {
      let j = i
      while (j < tagged.length && tagged[j].tag === 'name') j++
      push(EL.nameRow(H.nameRow()))
      prevTag = 'name'
      i = j
      continue
    }

    /* —— 栏目标签合并：加粗短标题 + 紧随的 1~2 段 —— */
    if (cur.tag === 'mergehead') {
      const paras = []
      let j = i + 1
      while (j < tagged.length && tagged[j].tag === 'para' && paras.length < 2) {
        paras.push(tagged[j])
        j++
      }
      const nextIsPara = j < tagged.length && tagged[j].tag === 'para'
      if (paras.length && !nextIsPara) {
        push(EL.paragraph(H.label(cur.extra.title, paras.map((p) => p.b.html).join(''))))
        prevTag = 'paragraph'
        i = j
        continue
      }
      // 合并条件不成立就退化成二级小标题
      push(EL.subhead(H.h3(esc(cur.extra.title))))
      prevTag = 'subhead'
      i++
      continue
    }

    switch (cur.tag) {
      case 'section':
        push(EL.section(H.section(cur.extra.num, cur.extra.title)))
        break
      case 'h3': {
        if (cur.plain) {
          push(EL.subhead(H.h3(esc(cur.extra.title))))
        } else {
          const num = cur.extra.num
          const sep = /^[一二三四五六七八九十]+$/.test(num) ? '、' : '. '
          push(EL.subhead(H.h3(`${cur.numbered ? `${num}${sep}` : ''}${esc(cur.extra.title)}`)))
        }
        break
      }
      case 'circle': {
        const mark = CIRCLED[circleNo++] ?? `${circleNo}.`
        push(EL.paragraph(H.para(`${mark} ${stripLead(cur.b.html)}`)))
        break
      }
      case 'req': {
        reqNo += 1
        push(EL.req(H.req(`${reqNo}. ${stripLead(cur.b.html)}`)))
        break
      }
      case 'chain':
        push(EL.chain(H.chain(cur.b.text)))
        break
      case 'trap':
        push(EL.trap(H.trap(stripTrapMark(cur.b.html))))
        break
      case 'concept':
        push(EL.paragraph(H.label(cur.extra.name, esc(cur.extra.rest))))
        break
      case 'note':
        push(EL.note(H.note(cur.b.html)))
        break
      case 'label':
        push(EL.paragraph(H.label(cur.extra.name, esc(cur.extra.rest))))
        break
      case 'answer':
        warnings.push(`答案段未归入题目：「${cur.b.text.slice(0, 16)}」`)
        push(EL.paragraph(H.para(cur.b.html)))
        break
      default:
        push(EL.paragraph(H.para(cur.b.html)))
    }
    prevTag = cur.tag
    i++
  }

  return { elements, warnings: warnings.filter((w) => !w.includes('参与归并')) }
}

/* ------------------------------------------------------------------ *
 * 短条目合并 / 拆分
 * ------------------------------------------------------------------ */

/**
 * 把连续的同类短条目合成一个组件，并保留原始分片到 `parts`。
 *
 * 合并只做「同层 HTML 直接拼接」，不做任何改写 —— 所以拆开能 100% 还原，
 * 观感也和拆开时一致（只少了组件之间的 4px 间距）。
 *
 * @param {Array} elements
 * @param {{merge?: boolean}} opts merge=false 时保持拆分，但仍标注可合并组
 */
export function mergeShortRuns(elements, opts = {}) {
  const merge = opts.merge !== false
  const out = []
  let groupSeq = 0

  for (let i = 0; i < elements.length; i++) {
    const cur = elements[i]
    if (!MERGE_VARIANTS.has(cur.variant) || !isShortItem(cur)) {
      out.push(cur)
      continue
    }

    // 向后收集同变体的连续短条目
    const run = [cur]
    let j = i + 1
    while (
      j < elements.length &&
      elements[j].variant === cur.variant &&
      isShortItem(elements[j]) &&
      run.length < MERGE_MAX_ITEMS
    ) {
      run.push(elements[j])
      j++
    }

    if (run.length < 2) {
      out.push(cur)
      continue
    }

    // 紧邻上方的同类小标题一并带上，避免标题单独留在上一栏/上一页底部
    const prev = out[out.length - 1]
    const headEl = prev && prev.variant === 'subhead' && MERGE_HEADING.test(plain(prev.html)) ? out.pop() : null
    const group = headEl ? [headEl, ...run] : run
    const grp = groupSeq++

    if (merge) {
      out.push({
        ...cur,
        grp,
        html: group.map((el) => el.html).join(''),
        parts: group.map((el) => ({ variant: el.variant, html: el.html })),
      })
    } else {
      // 拆开：每个分片还原成独立组件，但仍带同一个 grp，前端可据此再合并
      for (const el of group) out.push({ ...el, grp })
    }
    i = j - 1
  }

  return out
}

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

function formatDate(d) {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

const looksLikeDate = (t) => /^\s*(?:\d{4}\s*[.\-年/]\s*)?\d{1,2}\s*[.\-月/]\s*\d{1,2}\s*日?\s*$/.test(t)
const looksLikeIssue = (t) => /^第?\s*[一二三四五六七八九十\d]+\s*期(\s|$)/.test(t) && t.length <= 16

/**
 * 报头三行：期刊号 / 主标题 / 三个关键词。
 *
 * 周刊的报头形状是固定的：
 *     期刊一
 *     超强厄尔尼诺已经形成
 *     海—气相互作用 · 全球气候异常 · 高考必考
 *
 * 所以不靠「第一段就是标题」这种假设，而是按语义找：
 * - 期刊号：正文里出现「期刊X」优先，其次「第X期」，都没有就默认「期刊一」
 * - 主标题：「期刊一：超强厄尔尼诺已经形成」冒号后面那段；
 *           没有这种写法时，退化成第一个「够短、没句读、不是元信息」的行
 * - 关键词：从「本节核心考点为 海—气相互作用与全球气候异常」里按「与/及/、」拆词，
 *           取前两个；第三个固定「高考必考」（正文提过高考时）
 *
 * @returns {{kicker: string, title: string, titleIdx: number, keywords: string[], used: Set<number>}}
 */
function composeHead(blocks, idxs) {
  const CN = '[一二三四五六七八九十百零\\d]{1,3}'
  // 页脚元信息绝不能当标题：「地理限时训练 使用日期：… 编辑：… 核对：…」就被误判过一次
  const isMeta = (t) =>
    /使用日期|编辑\s*[：:]|核对\s*[：:]|校对\s*[：:]|地理限时训练|姓名\s*[：:]|学号|尺幅千里|思接寰宇|卷纳乾坤/.test(t)

  const cands = idxs
    .slice(0, 16)
    .map((i) => ({ i, t: String(blocks[i].text || '').trim() }))
    .filter((c) => c.t && !isMeta(c.t) && !isFieldCode(c.t))

  const used = new Set()

  /* 1. 期刊号 */
  let kicker = ''
  let kickerIdx = -1
  for (const c of cands) {
    const m = new RegExp(`期刊\\s*(${CN})`).exec(c.t)
    if (m) {
      kicker = `期刊${m[1]}`
      kickerIdx = c.i
      break
    }
  }
  if (!kicker) {
    for (const c of cands) {
      const m = new RegExp(`第\\s*(${CN})\\s*期`).exec(c.t)
      if (m) {
        kicker = `第${m[1]}期`
        kickerIdx = c.i
        break
      }
    }
  }
  if (!kicker) kicker = '期刊一'

  /* 2. 主标题 */
  const withKicker = new RegExp(`^(?:期刊\\s*${CN}|第\\s*${CN}\\s*期)\\s*[：:]\\s*(.+)$`)
  let title = ''
  let titleIdx = -1
  for (const c of cands) {
    const m = withKicker.exec(c.t)
    if (m && m[1].trim().length >= 4) {
      title = m[1].trim()
      titleIdx = c.i
      break
    }
  }
  if (!title) {
    for (const c of cands) {
      const t = c.t
      if (c.i === kickerIdx) continue
      if (t.length < 5 || t.length > 28) continue
      if (/[。；，,;：:]/.test(t)) continue
      if (new RegExp(`^(?:期刊|第)\\s*${CN}\\s*期?$`).test(t)) continue
      title = t
      titleIdx = c.i
      break
    }
  }
  if (titleIdx >= 0) used.add(titleIdx)
  if (kickerIdx >= 0 && kickerIdx !== titleIdx) used.add(kickerIdx)

  /* 3. 关键词 */
  const keywords = []
  const cutWords = (str) =>
    str
      .split(/[与及、；;，,\/]/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2 && x.length <= 14)
  const addWords = (arr) => {
    for (const k of arr) {
      if (keywords.length >= 2) break
      if (!keywords.includes(k)) keywords.push(k)
    }
  }

  const score = cands.find((c) => /核心考点/.test(c.t))
  if (score) {
    const m = /核心考点\s*(?:为|是)?\s*[：:]?\s*([^。；\n]+)/.exec(score.t)
    if (m) addWords(cutWords(m[1]))
  }
  const whole = blocks.map((b) => b.text || '').join('')
  if (keywords.length < 2) {
    const m = /内容\s*[：:]\s*([^。\n]+)/.exec(whole)
    if (m) addWords(cutWords(m[1].replace(/[+＋]/g, '、')))
  }
  if (/高考/.test(whole)) keywords.push('高考必考')
  else if (keywords.length < 3 && /时政|热点/.test(whole)) keywords.push('时政热点')

  return { kicker, title, titleIdx, keywords: keywords.slice(0, 3), used }
}

/** 把报头三行渲染成 HTML */
function mastheadHtml(head) {
  const sub = head.keywords.join(' · ')
  return (
    `<div class="masthead">` +
    (head.kicker ? `<div class="kicker">${esc(head.kicker)}</div>` : '') +
    `<h1>${esc(head.title)}</h1>` +
    `<div class="sub">${sub ? esc(sub) : '\u00a0'}</div>` +
    `</div>`
  )
}

/**
 * 报头（masthead）抽取。
 * - 常规稿：第一段就是刊名大标题，沿用原逻辑
 * - 纯文本稿：开头是「刊名 / 期数 / 栏目名 / 主标题 / 媒体来源」混杂，
 *   要找真正的标题行，并把剩下的来源信息合成一条导语
 */
function pickMasthead(blocks, plainText) {
  const idxs = []
  blocks.forEach((b, i) => {
    if (!b.empty && b.text && !isFieldCode(b.text)) idxs.push(i)
  })
  if (!idxs.length) return { masthead: '', usedIdx: new Set(), lead: '' }

  if (!plainText) {
    const head = composeHead(blocks, idxs)
    if (!head.title) return { masthead: '', usedIdx: new Set(), lead: '' }
    return { masthead: mastheadHtml(head), usedIdx: head.used, lead: '' }
  }

  /* —— 纯文本稿 —— */
  const used = new Set()
  const journalRe = /^(地理时政周刊|GEO WEEKLY)/i
  const isHeadNoise = (t) =>
    journalRe.test(t) || isPlainNoise(t) || looksLikeDate(t) || looksLikeIssue(t) || /^[@#]|^["“”]|^\s*[A-Za-z0-9：:\-\s]+$/.test(t)

  const head = composeHead(blocks, idxs)
  const titleIdx = head.titleIdx
  head.used.forEach((i) => used.add(i))
  if (!head.title && titleIdx < 0) return { masthead: '', usedIdx: used, lead: '' }

  // 副标题兜底：原稿自己带了「A · B · C」这种关键词行就直接用
  if (!head.keywords.length) {
    for (const i of idxs.filter((x) => x > titleIdx).slice(0, 3)) {
      const t = blocks[i].text.trim()
      if (t.length > 30) break
      if (/[·]/.test(t)) {
        head.keywords = t.split('·').map((v) => v.trim()).filter(Boolean)
        used.add(i)
        break
      }
    }
  }

  // 报头区的来源信息：挑最长的一句当导语，媒体名当来源
  let leadText = ''
  let source = ''
  // 报头区到「第一个章节行」为止，中间的媒体来源、时间、栏目词都算报头
  let headEnd = idxs.length ? idxs[idxs.length - 1] + 1 : 0
  for (const i of idxs.filter((x) => x > titleIdx)) {
    const t = blocks[i].text.trim()
    if (t.length <= 24 && (RE_SECTION_LOOSE.test(t) || (isShortTitle(t) && SECTION_WORDS.test(t)))) {
      headEnd = i
      break
    }
  }
  for (const i of idxs.filter((x) => x > titleIdx && x < headEnd)) {
    if (used.has(i)) continue
    const t = blocks[i].text.trim()
    if (isHeadNoise(t)) continue
    if (/CCTV|央视|新华社|人民日报|来源|报道|新闻/.test(t) && t.length <= 16) {
      if (!source) source = t
      continue
    }
    if (t.length > leadText.length) leadText = t
  }
  used.add(titleIdx)
  // 只吃掉真正的元信息（刊名、期数、日期、页脚信息），
  // 「对接教材：…」「内容：…」这些是正文，不能跟着报头一起消失
  const headMeta = /使用日期|编辑\s*[：:]|核对\s*[：:]|校对\s*[：:]|地理限时训练|尺幅千里|思接寰宇|卷纳乾坤/
  for (const i of idxs.filter((x) => x < titleIdx || (x > titleIdx && x < headEnd))) {
    if (isHeadNoise(blocks[i].text.trim()) || headMeta.test(blocks[i].text)) used.add(i)
  }

  // 教学刊物的开头没有媒体来源，硬加「导语：」只会把「内容：教材本源+…」顶到第一段
  const lead = leadText && source ? `<p><span class="label">导语：</span>${esc(leadText)}（来源：${esc(source)}）</p>` : ''

  const masthead = mastheadHtml(head)
  return { masthead, usedIdx: used, lead }
}

/**
 * @param {Array} blocks
 * @param {{images?: Array<{url?: string, width: number, height: number, mime: string}>, merge?: boolean}} opts
 *   merge 只决定「初稿默认是否合并」；前端还可以按 parts 再拆分，不影响识别结果
 */
export function buildElements(blocks, opts = {}) {
  const warnings = []
  const meta = extractMeta(blocks)
  const images = opts.images ?? []
  const plainText = opts.plainText ?? isPlainTextDoc(blocks)

  /* 报头：常规稿取第一段；纯文本稿要跳过刊名/期数/来源行 */
  const head = pickMasthead(blocks, plainText)
  const masthead = head.masthead
  const firstIdx = -1

  /* 去掉报头已用掉的行、刊名行、页脚信息行、页码域 */
  const journalRe = meta.journal ? new RegExp(`^${meta.journal}[一二三四五六七八九十\\d]*$`) : null
  const noise = (b, idx) => {
    if (head.usedIdx.has(idx)) return true
    const t = b.text
    if (!t) return true
    if (isFieldCode(t)) return true
    if (/使用日期|卷纳乾坤|思接寰宇|笔绘山河/.test(t)) return true
    if (/^地理限时训练/.test(t) && t.length < 40) return true
    if (journalRe && journalRe.test(t)) return true
    if (plainText && isPlainNoise(t)) return true
    return false
  }

  const body = blocks.filter((b, idx) => !noise(b, idx))
  const tagged = tagBlocks(body, { plainText })
  const { elements: grouped } = groupBlocks(tagged, warnings, { quizSplit: opts.quizSplit })

  // 短条目先按「可合并组」聚合（保留 parts），合并/拆分由导入时的开关决定
  const elements = mergeShortRuns(grouped, { merge: opts.merge !== false })
  if (head.lead && opts.lead !== false) elements.unshift({ ...EL.paragraph(head.lead) })
  const mergedCount = elements.filter((el) => el.parts && el.parts.length > 1).length
  const coveredCount = elements.reduce((s, el) => s + (el.parts ? el.parts.length : 1), 0)

  /* 配图：宽高比 < 4 的第一张当作正文插图，放在正文最前（其余只入库） */
  const figure = images.find((img) => img.width > 0 && img.height > 0 && img.width / img.height < 4)
  if (figure) {
    const ratio = figure.width / figure.height
    elements.unshift({ ...EL.image(H.image(figure.url ?? '', ratio)), ratio, src: figure.url ?? '' })
  }

  const header = `<div class="header"><div class="header-left"><div class="header-title">${esc(
    meta.journal || '地理时政周刊',
  )} <span>${esc(meta.en)}</span></div></div><div class="header-right"><div class="issue">${esc(
    meta.issue || '第一期',
  )}</div><div>${esc(meta.date || formatDate(new Date()))}</div></div></div>`

  // 页脚只放三档信息：使用日期 / 编辑 / 核对。多塞一档会把两行挤成一行。
  const footDate = (meta.useDate || formatDate(new Date())).replace(/年|月/g, '.').replace(/日/g, '')
  const footer = `<div class="footer"><div class="footer-top"><span>${esc(
    meta.sloganLeft || '尺幅千里，卷纳乾坤',
  )}</span><span class="center">— 1 / 1 —</span><span>${esc(
    meta.sloganRight || '思接寰宇，笔绘山河',
  )}</span></div><div class="footer-bottom"><span>使用日期：${esc(
    footDate,
  )}</span><span>编辑：${esc(meta.editor || '曹明环')}</span><span>核对：${esc(meta.proofreader || '何文静')}</span></div></div>`

  return { masthead, header, footer, elements, warnings, meta, mergeStats: { groups: mergedCount, covered: coveredCount } }
}

export { plain, esc, H, EL }
