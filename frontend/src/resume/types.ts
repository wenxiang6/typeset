/** 简历排版后门 —— 数据模型 */

export interface ContactItem {
  /** 图标类型：phone / mail / user / code / pin，用内置 SVG 图标，保证精确复刻 */
  icon: 'phone' | 'mail' | 'user' | 'code' | 'pin'
  text: string
  /** 标签样式（蓝底白字小标签） */
  tag?: boolean
}

export interface ResumeHeader {
  name: string
  contacts: ContactItem[]
  /** 证件照（data URL 或图片地址，空则显示占位框） */
  photo?: string
}

export interface EducationItem {
  school: string
  major: string
  degree: string
  period: string
}

export interface BulletItem {
  /** 加粗关键词（不含冒号） */
  key: string
  text: string
}

export interface SkillSection {
  /** 小标题，如「具体性和量化」 */
  heading: string
  /** 标题下的说明段 */
  intro: string
}

export interface SkillOtherSection {
  /** 「其他：」段 */
  heading: string
  bullets: BulletItem[]
}

/** 工作经历条目（可多个） */
export interface WorkItem {
  company: string
  period: string
  department: string
  role: string
  city: string
  bullets: BulletItem[]
}

/** 项目经历条目（可多个） */
export interface ProjectItem {
  name: string
  period: string
  role: string
  city: string
  bullets: BulletItem[]
}

export interface ResumeSection {
  title: string
  type: 'education' | 'skills' | 'work' | 'project'
  educations?: EducationItem[]
  skill?: SkillSection
  other?: SkillOtherSection
  works?: WorkItem[]
  projects?: ProjectItem[]
}

export interface ResumeData {
  /** 主色（精确复刻模板蓝色） */
  accent: string
  /** 标题条浅蓝底 */
  accentSoft: string
  header: ResumeHeader
  sections: ResumeSection[]
}
