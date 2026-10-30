/**
 * 简历排版后门 —— 「简历数据 → 语义 Doc」生成器
 *
 * 产出编辑器认的 Doc JSON（{ pages: [{ els: [...] }] }）。
 * 每个模块（个人信息 / 教育 / 技能 / 工作 / 项目）是**独立元素**，
 * 纵向堆叠成单栏 A4 竖版；工作经历 / 项目经历内部按条目循环输出，
 * 支持多份工作、多个项目。
 *
 * 依赖编辑器内核的 autoHeight + autoPage：元素按真实内容自动增高、超出自动翻页，
 * 因此这里只给每个模块一个初始高度与纵向起点，具体由内核测量修正。
 */

import type { Doc, El } from '../editor/types'
import { A4 } from '../editor/layout'
import type { ContactItem, ProjectItem, ResumeData, ResumeSection, WorkItem } from './types'

const PAGE_W = A4.portrait.w
const PAGE_H = A4.portrait.h

const MARGIN_L = 60
const MARGIN_R = 60
const MARGIN_T = 56
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R
const GAP = 6 // 模块间距

let seq = 0
let zSeq = 0
function elid(): string {
  seq += 1
  return `rs-${seq}`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* ------------------------------------------------------------------ *
 * 图标（SVG，精确复刻模板实心蓝图标）
 * ------------------------------------------------------------------ */

function contactIcon(c: ContactItem): string {
  const color = 'currentColor'
  switch (c.icon) {
    case 'phone':
      return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="${color}" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02l-2.2 2.2z"/></svg>`
    case 'mail':
      return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="${color}" d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>`
    case 'user':
      return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="${color}" d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.34 0-10 1.67-10 5v2a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2c0-3.33-6.66-5-10-5z"/></svg>`
    case 'code':
      return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="${color}" d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`
    case 'pin':
      return `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="${color}" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5z"/></svg>`
    default:
      return ''
  }
}

/* ------------------------------------------------------------------ *
 * 各模块 HTML
 * ------------------------------------------------------------------ */

function headerHtml(d: ResumeData): string {
  const contacts = d.header.contacts
    .map((c) => {
      const icon = contactIcon(c)
      const inner = `<span class="rs-ci">${icon}</span><span class="rs-ct">${esc(c.text)}</span>`
      return c.tag ? `<span class="rs-c rs-c-tag">${inner}</span>` : `<span class="rs-c">${inner}</span>`
    })
    .join('')
  const photo = d.header.photo
    ? `<img class="rs-photo" src="${esc(d.header.photo)}" alt="证件照" />`
    : `<div class="rs-photo rs-photo-ph"><span>证件照</span></div>`
  return `<div class="rs-header">
    <div class="rs-h-left">
      <div class="rs-name">${esc(d.header.name)}</div>
      <div class="rs-contacts">${contacts}</div>
    </div>
    <div class="rs-h-right">${photo}</div>
  </div>`
}

function sectionTitleHtml(title: string): string {
  return `<div class="rs-sec-title"><span class="rs-sec-bar"></span><span class="rs-sec-text">${esc(title)}</span></div>`
}

function educationHtml(sec: ResumeSection): string {
  const rows = (sec.educations ?? [])
    .map(
      (e) => `<div class="rs-edu-row">
        <span class="rs-edu-school">${esc(e.school)}</span>
        <span class="rs-edu-major">${esc(e.major)}</span>
        <span class="rs-edu-degree">${esc(e.degree)}</span>
        <span class="rs-edu-time">${esc(e.period)}</span>
      </div>`,
    )
    .join('')
  return `<div class="rs-education">${rows}</div>`
}

function skillsHtml(sec: ResumeSection): string {
  const parts: string[] = []
  if (sec.skill) {
    parts.push(`<div class="rs-sk-heading">${esc(sec.skill.heading)}</div>`)
    parts.push(`<p class="rs-sk-intro">${esc(sec.skill.intro)}</p>`)
  }
  if (sec.other) {
    parts.push(`<div class="rs-sk-other-heading">${esc(sec.other.heading)}</div>`)
    const items = sec.other.bullets
      .map((b) => `<li class="rs-sk-item"><span class="rs-sk-key">${esc(b.key)}</span>${esc(b.text)}</li>`)
      .join('')
    parts.push(`<ol class="rs-sk-list">${items}</ol>`)
  }
  return `<div class="rs-skills">${parts.join('')}</div>`
}

/** 工作经历：单条目组件 */
function workItemHtml(w: WorkItem): string {
  const bullets = w.bullets.map((b) => `<li><span class="rs-work-key">${esc(b.key)}</span>${esc(b.text)}</li>`).join('')
  return `<div class="rs-work">
    <div class="rs-work-head">
      <span class="rs-work-company">${esc(w.company)}</span>
      <span class="rs-work-time">${esc(w.period)}</span>
    </div>
    <div class="rs-work-sub">
      <span class="rs-work-dept">${esc(w.department)}</span>
      <span class="rs-work-role">${esc(w.role)}</span>
      <span class="rs-work-city">${esc(w.city)}</span>
    </div>
    <ol class="rs-work-list">${bullets}</ol>
  </div>`
}

function workHtml(sec: ResumeSection): string {
  return `<div class="rs-works">${(sec.works ?? []).map(workItemHtml).join('')}</div>`
}

/** 项目经历：单条目组件 */
function projectItemHtml(p: ProjectItem): string {
  const bullets = p.bullets.map((b) => `<li><span class="rs-work-key">${esc(b.key)}</span>${esc(b.text)}</li>`).join('')
  return `<div class="rs-work rs-project">
    <div class="rs-work-head">
      <span class="rs-work-company">${esc(p.name)}</span>
      <span class="rs-work-time">${esc(p.period)}</span>
    </div>
    <div class="rs-work-sub">
      <span class="rs-work-role">${esc(p.role)}</span>
      <span class="rs-work-city">${esc(p.city)}</span>
    </div>
    <ol class="rs-work-list">${bullets}</ol>
  </div>`
}

function projectHtml(sec: ResumeSection): string {
  return `<div class="rs-works">${(sec.projects ?? []).map(projectItemHtml).join('')}</div>`
}

function sectionBodyHtml(sec: ResumeSection): string {
  switch (sec.type) {
    case 'education':
      return educationHtml(sec)
    case 'skills':
      return skillsHtml(sec)
    case 'work':
      return workHtml(sec)
    case 'project':
      return projectHtml(sec)
    default:
      return ''
  }
}

/* ------------------------------------------------------------------ *
 * 组装 Doc：每个模块一个独立元素，纵向堆叠
 * ------------------------------------------------------------------ */

/** 模块初始高度（autoHeight 会按真实内容修正，这里只是起点） */
function estimateHeight(sec: ResumeSection): number {
  switch (sec.type) {
    case 'education':
      return 36 + (sec.educations?.length ?? 0) * 28
    case 'skills':
      return 90 + (sec.other?.bullets.length ?? 0) * 30
    case 'work':
      return 60 + (sec.works ?? []).reduce((n, w) => n + 40 + w.bullets.length * 26, 0)
    case 'project':
      return 60 + (sec.projects ?? []).reduce((n, p) => n + 40 + p.bullets.length * 26, 0)
    default:
      return 60
  }
}

export function resumeToDoc(data: ResumeData): Doc {
  const accent = data.accent || '#4A7BF7'
  const accentSoft = data.accentSoft || '#DCE6FB'
  const root = `<div class="rs-root" style="--rs-accent:${accent};--rs-accent-soft:${accentSoft};">`

  const els: El[] = []
  let y = MARGIN_T

  // 1. 个人信息区（含模块头部）
  zSeq += 1
  els.push({
    id: elid(),
    z: zSeq,
    kind: 'box',
    variant: 'resume',
    html: `${root}${headerHtml(data)}</div>`,
    x: MARGIN_L,
    y,
    w: CONTENT_W,
    h: 96,
    autoHeight: true,
  })
  y += 96 + GAP

  // 2. 各模块
  for (const sec of data.sections) {
    const h0 = estimateHeight(sec)
    zSeq += 1
    els.push({
      id: elid(),
      z: zSeq,
      kind: 'box',
      variant: 'resume',
      html: `${root}${sectionTitleHtml(sec.title)}${sectionBodyHtml(sec)}</div>`,
      x: MARGIN_L,
      y,
      w: CONTENT_W,
      h: h0,
      autoHeight: true,
    })
    y += h0 + GAP
  }

  return {
    version: 3,
    w: PAGE_W,
    h: PAGE_H,
    orientation: 'portrait',
    margin: { top: MARGIN_T, right: MARGIN_R, bottom: 48, left: MARGIN_L },
    flow: { autoHeight: true, autoPage: true },
    watermark: { text: '', size: 14, opacity: 0, angle: 0 },
    defaults: {
      fontFamily: '"Lantinghei SC","PingFang SC","Heiti SC","SimHei","Microsoft YaHei",sans-serif',
      fontSize: '14px',
    },
    pages: [{ id: 'rs-page-0', els }],
  }
}
