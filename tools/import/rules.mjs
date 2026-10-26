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
      const cut = t.search(/思接寰宇|笔绘山河/)
      if (cut > 0) {
        meta.sloganLeft = t.slice(0, cut).trim()
        meta.sloganRight = t.slice(cut).trim()
      } else {
        meta.sloganLeft = t.trim()
      }
    }

    const d = /使用日期[：:]\s*([0-9]{4}\s*年\s*[0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日)/.exec(t)
    if (d) meta.useDate = d[1].replace(/\s+/g, '')
    const ed = /编辑[：:]\s*([\u4e00-\u9fa5]{2,4})/.exec(t)
    if (ed) meta.editor = ed[1]
    const pf = /(?:核对|校对)[：:]\s*([\u4e00-\u9fa5]{2,4})/.exec(t)
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
 */
export function tagBlocks(blocks) {
  const out = []
  let sectionTitle = ''
  let h3Title = ''
  let circleList = false

  for (const b of blocks) {
    if (b.empty) continue
    const t = b.text
    if (!t) continue
    if (isFieldCode(t)) continue

    const resetList = () => {
      circleList = false
    }

    /* 一级标题：一、教材定位（靠字号和二级区分：16px vs 15px） */
    const sec = RE_SECTION.exec(t)
    if (sec && t.length <= 40) {
      if (b.fontSize >= SIZE_L1) {
        sectionTitle = sec[2].trim()
        h3Title = ''
        resetList()
        out.push({ b, tag: 'section', extra: { num: sec[1], title: sec[2].trim() } })
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

    /* 二级标题：1. 定义与判定 */
    const h3 = RE_H3.exec(t)
    if (h3 && b.fontSize >= SIZE_L2 && !/[。；]/.test(t)) {
      h3Title = t
      resetList()
      out.push({ b, tag: 'h3', extra: { num: h3[1], title: h3[2].trim() }, numbered: true })
      continue
    }

    /* 选择题选项 */
    const opt = RE_OPTION.exec(t)
    if (opt && t.length <= 80) {
      resetList()
      out.push({ b, tag: 'option', extra: { key: opt[1], text: opt[2].trim() } })
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

    /* 易错项：章节上下文优先，其次关键词 */
    if (TRAP_CTX.test(sectionTitle) || (TRAP_WORDS.test(t) && t.length < 120 && !/^[（(]/.test(t))) {
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

export function groupBlocks(tagged, warnings = []) {
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
      const stemHtml = stemEl ? stemEl.html.replace(/^<p>/, '').replace(/<\/p>$/, '') : ''
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

    /* —— 综合大题：题干材料 + （1）（2）（3）+ 标准答案 —— */
    if (cur.tag === 'question') {
      const parts = []
      // 回吞紧邻的「阅读材料…」段，让它成为题目的一部分
      while (elements.length) {
        const last = elements[elements.length - 1]
        if (last.variant !== 'paragraph') break
        const txt = plain(last.html)
        if (/^(阅读材料|阅读图文|材料[：:]|材料$)/.test(txt) || txt.length < 90) {
          parts.unshift(`<p>${last.html.replace(/^<p>/, '').replace(/<\/p>$/, '')}</p>`)
          elements.pop()
          continue
        }
        break
      }
      while (i < tagged.length && tagged[i].tag === 'question') {
        parts.push(`<p><strong>${esc(tagged[i].extra.text)}</strong></p>`)
        i++
        // 「标准答案」这几个字单独成段，作为下一段的前缀标记
        let answerMark = false
        while (i < tagged.length && tagged[i].tag === 'answer') {
          answerMark = true
          i++
        }
        while (i < tagged.length && tagged[i].tag !== 'question' && !isBreakTag(tagged[i].tag)) {
          const t = tagged[i]
          if (t.tag === 'h3' || t.tag === 'option') break
          if (t.tag === 'answer') {
            answerMark = true
          } else {
            const prefix = answerMark ? '<span class="ans">标准答案：</span>' : ''
            parts.push(`<p>${prefix}${t.b.html}</p>`)
            answerMark = false
          }
          i++
        }
      }
      push(EL.quiz(H.quiz(parts.join(''))))
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
        push(EL.paragraph(H.para(`${mark} ${cur.b.html}`)))
        break
      }
      case 'req': {
        reqNo += 1
        push(EL.req(H.req(`${reqNo}. ${cur.b.html}`)))
        break
      }
      case 'chain':
        push(EL.chain(H.chain(cur.b.text)))
        break
      case 'trap':
        push(EL.trap(H.trap(cur.b.html)))
        break
      case 'concept':
        push(EL.concept(H.concept(cur.extra.name, esc(cur.extra.rest))))
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

/**
 * @param {Array} blocks
 * @param {{images?: Array<{url?: string, width: number, height: number, mime: string}>, merge?: boolean}} opts
 *   merge 只决定「初稿默认是否合并」；前端还可以按 parts 再拆分，不影响识别结果
 */
export function buildElements(blocks, opts = {}) {
  const warnings = []
  const meta = extractMeta(blocks)
  const images = opts.images ?? []

  /* 刊名大标题：第一个非空段落 */
  const firstIdx = blocks.findIndex((b) => !b.empty && !isFieldCode(b.text))
  let masthead = ''
  if (firstIdx >= 0) {
    const b = blocks[firstIdx]
    const m = /^(.{1,8})[：:]\s*(.+)$/.exec(b.text)
    const kicker = m ? m[1] : ''
    const title = m ? m[2] : b.text
    masthead = `<div class="masthead">${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}<h1>${esc(
      title,
    )}</h1><div class="sub">&nbsp;</div></div>`
  }

  /* 去掉刊名行、页脚信息行、页码域 */
  const journalRe = meta.journal ? new RegExp(`^${meta.journal}[一二三四五六七八九十\\d]*$`) : null
  const noise = (b, idx) => {
    if (idx === firstIdx) return true
    const t = b.text
    if (!t) return true
    if (isFieldCode(t)) return true
    if (/使用日期|卷纳乾坤|思接寰宇/.test(t)) return true
    if (/^地理限时训练/.test(t) && t.length < 40) return true
    if (journalRe && journalRe.test(t)) return true
    return false
  }

  const body = blocks.filter((b, idx) => !noise(b, idx))
  const tagged = tagBlocks(body)
  const { elements: grouped } = groupBlocks(tagged, warnings)

  // 短条目先按「可合并组」聚合（保留 parts），合并/拆分由导入时的开关决定
  const elements = mergeShortRuns(grouped, { merge: opts.merge !== false })
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

  const footer = `<div class="footer"><div class="footer-top"><span>${esc(
    meta.sloganLeft || '尺幅千里，卷纳乾坤',
  )}</span><span class="center">— 1 / 1 —</span><span>${esc(
    meta.sloganRight || '思接寰宇，笔绘山河',
  )}</span></div><div class="footer-bottom"><span>地理限时训练</span><span>使用日期：${esc(
    meta.useDate || formatDate(new Date()),
  )}</span><span>编辑：${esc(meta.editor || '')}</span><span>核对：${esc(meta.proofreader || '')}</span></div></div>`

  return { masthead, header, footer, elements, warnings, meta, mergeStats: { groups: mergedCount, covered: coveredCount } }
}

export { plain }
