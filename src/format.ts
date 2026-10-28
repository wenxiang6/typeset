/**
 * 服务器端自动装配页（无界面）
 *
 * 用途：部署服务器收到 Word 上传后，用无头 Chromium 打开本页，
 * 本页把「元素列表」装配成带真实坐标的版面，再回传给服务器落库。
 *
 * 为什么非要浏览器：装配要按栏宽量真实高度（量高 / 分栏 / 避让 / 溢出翻页 / 按行切割），
 * 脱离 DOM 算不出正确坐标。服务器端跑一次无头浏览器，客户端就什么环境都不用装。
 *
 * 地址：/format.html?job=<jobId>&orientation=landscape|portrait
 */
// 量高依赖的样式一个都不能少：.ed-page 的字体族/字号/行高在 editor.css，
// 组件（trap/tpl/quiz 等）的盒模型在 widgets.css / templates.css
import './styles/global.css'
import './styles/newspaper.css'
import './editor/editor.css'
import './editor/widgets.css'
import './editor/templates.css'
import { importToDoc, type ImportPayload } from './editor/importDoc'
import type { Orientation } from './editor/types'

function report(text: string) {
  const el = document.getElementById('status')
  if (el) el.textContent = text
}

async function run() {
  const params = new URLSearchParams(location.search)
  const job = params.get('job') ?? ''
  const orientation = (params.get('orientation') === 'portrait' ? 'portrait' : 'landscape') as Orientation
  if (!job) return report('缺少 job')

  try {
    report('读取元素…')
    const resp = await fetch(`/api/format/payload?job=${encodeURIComponent(job)}`)
    if (!resp.ok) return report(`读取失败 HTTP ${resp.status}`)
    const payload = (await resp.json()) as ImportPayload

    // 字体没就绪时量出的行高偏小，分页会算少
    if (document.fonts?.ready) await document.fonts.ready

    report('装配版面…')
    const res = await importToDoc(payload, { orientation, merge: payload.mergeMode ?? 'merge' })

    // reflow 是异步翻页的，等版面稳定再回传，否则页数会少
    let prev = ''
    let same = 0
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 60))
      const sig = res.doc.pages.map((p) => p.els.map((e) => [e.id, Math.round(e.y), Math.round(e.h)])).join('|')
      if (sig === prev) {
        if (++same >= 2) break
      } else {
        prev = sig
        same = 0
      }
    }

    report('回传结果…')
    const save = await fetch('/api/format/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job, doc: res.doc, warnings: res.warnings ?? [] }),
    })
    if (!save.ok) return report(`回传失败 HTTP ${save.status}`)
    report(`完成：${res.doc.pages.length} 页`)
    // 给服务器一个明确的成功信号，方便它判断可以收工
    ;(window as unknown as { __formatDone?: boolean }).__formatDone = true
  } catch (err) {
    report(`出错：${String((err as Error)?.message || err)}`)
    await fetch('/api/format/result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job, error: String((err as Error)?.message || err) }),
    }).catch(() => {})
  }
}

void run()
