import type { Doc, El } from './types'
import { DEFAULT_LAYOUT } from './defaultLayout'
import { clone, reflowDoc } from './layout'

export interface Template {
  id: string
  name: string
  createdAt: number
  builtin?: boolean
  doc: Doc
}

export const TEMPLATES_KEY = 'paiban-templates-v1'
const FORMAT = 'paiban-template'

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function defaultTemplate(): Template {
  return {
    id: 'default',
    name: '默认模板 · 现有布局',
    createdAt: 0,
    builtin: true,
    doc: reflowDoc(clone(DEFAULT_LAYOUT)),
  }
}

export function loadSavedTemplates(): Template[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((t): t is Template => !!t && typeof t.id === 'string' && typeof t.name === 'string' && !!t.doc && Array.isArray(t.doc.pages))
  } catch {
    return []
  }
}

export function persistSavedTemplates(list: Template[]): boolean {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(list))
    return true
  } catch (err) {
    console.warn('[paiban] 模板保存失败', err)
    return false
  }
}

export function makeTemplate(name: string, doc: Doc): Template {
  return { id: uid('tpl'), name: name.trim() || '未命名模板', createdAt: Date.now(), doc: clone(doc) }
}

export function templateFileName(t: Template): string {
  return `${t.name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 40) || '模板'}.paiban.json`
}

export function templatePayload(t: Template): string {
  return JSON.stringify(
    {
      format: FORMAT,
      version: 1,
      name: t.name,
      createdAt: t.createdAt,
      exportedAt: new Date().toISOString(),
      doc: t.doc,
    },
    null,
    2,
  )
}

export function downloadTemplate(t: Template) {
  const blob = new Blob([templatePayload(t)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = templateFileName(t)
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function parseTemplateText(text: string): Template | null {
  try {
    const raw = JSON.parse(text)
    const doc = (raw?.doc ?? raw) as Doc
    if (!doc || !Array.isArray(doc.pages) || !doc.pages.length) return null
    const name = typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : '导入的模板'
    return { id: uid('tpl'), name, createdAt: Date.now(), doc }
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function imgToDataUrl(src: string): string | null {
  try {
    const img = Array.from(document.querySelectorAll('img')).find((i) => i.currentSrc === src || i.src === src)
    if (!img || !img.complete || !img.naturalWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d')?.drawImage(img, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/**
 * 模板分享前尝试把图片转成 data URL，避免换电脑后本地路径/相对资源丢失。
 * 无法读取的图片保留原地址，并返回缺失数量提示用户。
 */
export async function embedTemplateImages(doc: Doc): Promise<{ doc: Doc; missing: number }> {
  const next = clone(doc)
  const cache = new Map<string, string | null>()
  let missing = 0

  const els: El[] = next.pages.flatMap((p) => p.els)
  for (const el of els) {
    const src = el.src
    if (!src || src.startsWith('data:')) continue
    if (!cache.has(src)) {
      let data: string | null = null
      try {
        const resp = await fetch(src)
        if (resp.ok) data = await blobToDataUrl(await resp.blob())
      } catch {
        /* 尝试 DOM canvas */
      }
      if (!data) data = imgToDataUrl(src)
      cache.set(src, data)
    }
    const data = cache.get(src)
    if (data) el.src = data
    else missing++
  }

  return { doc: next, missing }
}

export function templateSummary(t: Template): string {
  return `${t.doc.pages.length} 页 · ${t.doc.orientation === 'portrait' ? 'A4 竖版' : 'A4 横版'}`
}
