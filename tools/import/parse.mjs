/**
 * .doc / .docx / .rtf → 结构化段落块（blocks）
 *
 * 转换优先用 macOS 自带的 textutil（零安装）。textutil 输出的 HTML 保留了
 * 每段的字号、对齐、加粗、段前距 —— 这些正是判断标题层级的依据。
 * 非 macOS（Windows 桌面版）依次尝试 LibreOffice → Word COM → WPS COM。
 *
 * 注意：字号只作为「层级信号」，不直接写进成品样式；成品样式由组件变体决定。
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const execFileAsync = promisify(execFile)

/** 调用 textutil 把 Word 文档转成 HTML */
async function viaTextutil(filePath) {
  const { stdout } = await execFileAsync(
    'textutil',
    ['-convert', 'html', '-stdout', '-encoding', 'UTF-8', filePath],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  return stdout
}

/** LibreOffice 常见安装位置（PATH 里没有时逐个试） */
const SOFFICE_CANDIDATES = [
  'soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
]

/** 从 HTML buffer 里认出编码（Word 导出中文 Windows 上常是 gb2312） */
function decodeHtmlBuffer(buf) {
  const head = buf.subarray(0, 4096).toString('latin1')
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(head)
  const label = (m?.[1] ?? 'utf-8').toLowerCase()
  try {
    return new TextDecoder(label === 'gb2312' ? 'gbk' : label, { fatal: false }).decode(buf)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf)
  }
}

/** LibreOffice headless 转 HTML（跨平台，装了就能用） */
async function viaSoffice(filePath) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'paiban-lo-'))
  try {
    let lastErr
    for (const bin of SOFFICE_CANDIDATES) {
      try {
        await execFileAsync(
          bin,
          ['--headless', '--norestore', '--convert-to', 'html', '--outdir', outDir, filePath],
          { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
        )
        const files = await readdir(outDir)
        const html = files.find((f) => /\.html?$/i.test(f))
        if (!html) throw new Error('LibreOffice 没有产出 HTML')
        return decodeHtmlBuffer(await readFile(path.join(outDir, html)))
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr ?? new Error('没有找到 soffice')
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Word / WPS 的 COM 自动化（Windows）：打开 → 另存为 HTML(8) → 关闭 */
async function viaOfficeCom(filePath, progId) {
  const outDir = await mkdtemp(path.join(os.tmpdir(), 'paiban-com-'))
  const outFile = path.join(outDir, 'out.html')
  const q = (p) => `'${p.replace(/'/g, "''")}'`
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$app = New-Object -ComObject ${progId}`,
    '$app.Visible = $false',
    '$app.DisplayAlerts = 0',
    `$doc = $app.Documents.Open(${q(filePath)}, $false, $true)`,
    `$doc.SaveAs2(${q(outFile)}, 8)`,
    '$doc.Close(0)',
    '$app.Quit()',
  ].join('; ')
  try {
    await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    })
    const files = await readdir(outDir)
    const html = files.find((f) => /\.html?$/i.test(f))
    if (!html) throw new Error(`${progId} 没有产出 HTML`)
    return decodeHtmlBuffer(await readFile(path.join(outDir, html)))
  } finally {
    await rm(outDir, { recursive: true, force: true }).catch(() => {})
  }
}

/** 本机可用的转换器（按优先级），用于错误提示 */
export function converterChain() {
  if (process.platform === 'darwin') return ['textutil', 'soffice']
  if (process.platform === 'win32') return ['soffice', 'Word COM', 'WPS COM']
  return ['soffice']
}

/** 任意平台：Word/RichText 文件 → HTML 字符串 */
export async function docToHtml(filePath) {
  const chain = []
  if (process.platform === 'darwin') chain.push(['textutil', () => viaTextutil(filePath)])
  chain.push(['soffice', () => viaSoffice(filePath)])
  if (process.platform === 'win32') {
    chain.push(['Word', () => viaOfficeCom(filePath, 'Word.Application')])
    chain.push(['WPS', () => viaOfficeCom(filePath, 'Kwps.Application')])
  }

  const errors = []
  for (const [name, run] of chain) {
    try {
      const html = await run()
      if (html && html.length > 40) return html
      errors.push(`${name}: 输出为空`)
    } catch (err) {
      errors.push(`${name}: ${String(err?.message || err).split('\n')[0]}`)
    }
  }
  throw new Error(
    `本机没有可用的 Word 转换器（已尝试 ${chain.map((c) => c[0]).join(' / ')}）：` +
      'macOS 自带 textutil；Windows 需安装 Word / WPS，或装一个免费的 LibreOffice；也可以把原稿另存为 .docx 后重试',
  )
}

/** 解析 textutil 生成的 <style> 块：class → {fontSize, align, marginTop, indent} */
function parseStyleClasses(css) {
  const map = new Map()
  const re = /([^{}]+)\{([^}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selectors = m[1]
    const body = m[2]
    const decl = {}
    for (const part of body.split(';')) {
      const idx = part.indexOf(':')
      if (idx < 0) continue
      const key = part.slice(0, idx).trim().toLowerCase()
      const val = part.slice(idx + 1).trim()
      decl[key] = val
    }
    const fontMatch = /([\d.]+)px/.exec(decl.font || '')
    const info = {
      fontSize: fontMatch ? parseFloat(fontMatch[1]) : 0,
      family: (decl.font || '').replace(/[\d.]+px\s*/, '').trim(),
      align: decl['text-align'] || '',
      marginTop: parseFloat(decl['margin-top'] || '0') || 0,
      marginBottom: parseFloat(decl['margin-bottom'] || '0') || 0,
      indent: parseFloat(decl['text-indent'] || '0') || 0,
      lineHeight: decl['line-height'] || '',
      color: decl.color || '',
    }
    for (const sel of selectors.split(',')) {
      const name = sel.trim().replace(/^p\./, '')
      if (name) map.set(name, info)
    }
  }
  return map
}

const ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => ENTITIES[m])
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
}

/**
 * 把一段内部 HTML 转成 runs（文本片段 + 是否加粗）。
 * 只保留加粗语义，其余标签（span/字体色）一律剥离。
 */
function toRuns(inner) {
  const src = inner
    .replace(/<span[^>]*class="Apple-converted-space"[^>]*>\s*<\/span>/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')

  const runs = []
  let bold = 0
  let buffer = ''
  const flush = () => {
    if (!buffer) return
    runs.push({ text: decodeEntities(buffer), bold: bold > 0 })
    buffer = ''
  }
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g
  let last = 0
  let m
  while ((m = re.exec(src))) {
    buffer += src.slice(last, m.index)
    last = m.index + m[0].length
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    if (tag === 'b' || tag === 'strong') {
      flush()
      bold += closing ? -1 : 1
      if (bold < 0) bold = 0
    }
  }
  buffer += src.slice(last)
  flush()

  return runs.filter((r) => r.text !== '' || r.bold)
}

const BLOCK_TAGS = /<(p|div|li|h[1-6]|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi

/**
 * HTML → blocks
 * @param {string} html
 * @returns {Array<object>}
 */
export function parseBlocks(html) {
  const styleMatch = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(html)
  const classes = styleMatch ? parseStyleClasses(styleMatch[1]) : new Map()

  const body = html.replace(/^[\s\S]*?<body[^>]*>/i, '')
  const blocks = []
  let m
  BLOCK_TAGS.lastIndex = 0
  while ((m = BLOCK_TAGS.exec(body))) {
    const tag = m[1].toLowerCase()
    const attrs = m[0].slice(0, m[0].indexOf('>') + 1)
    const cls = /class="([^"]*)"/.exec(attrs)?.[1]?.split(/\s+/)[0] ?? ''
    const info = classes.get(cls) ?? {}
    const runs = toRuns(m[2])
    const text = runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim()
    const boldChars = runs.filter((r) => r.bold).reduce((n, r) => n + r.text.replace(/\s/g, '').length, 0)
    const allChars = text.replace(/\s/g, '').length

    blocks.push({
      tag,
      cls,
      text,
      runs,
      html: runsToHtml(runs),
      fontSize: info.fontSize || 0,
      family: info.family || '',
      align: info.align || '',
      marginTop: info.marginTop || 0,
      indent: info.indent || 0,
      color: info.color || '',
      bold: allChars > 0 && boldChars / allChars > 0.85,
      empty: text.replace(/[\s\u00a0]/g, '') === '',
    })
  }
  return blocks
}

/** runs → 内联 HTML（只保留 <b>） */
export function runsToHtml(runs) {
  return runs
    .map((r) => {
      const t = r.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
      return r.bold ? `<b>${t}</b>` : t
    })
    .join('')
}

/** 一次性从文件路径产出 blocks */
export async function parseDocFile(filePath) {
  const html = await docToHtml(filePath)
  const blocks = parseBlocks(html)
  return { html, blocks }
}

/** 从内存 buffer 产出 blocks（供服务端接口用：先落临时文件再交给 textutil） */
export async function parseDocBuffer(buf, tmpPath) {
  const { writeFile, unlink } = await import('node:fs/promises')
  await writeFile(tmpPath, buf)
  try {
    return await parseDocFile(tmpPath)
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}

export { readFile }
