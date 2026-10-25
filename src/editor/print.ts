import type { Orientation } from './types'

interface PrintOptions {
  w: number
  h: number
  orientation: Orientation
  bw: boolean
}

/**
 * 打开一个只包含“纸张页面”的打印窗口。
 *
 * 不直接在编辑器页面上 window.print()：
 * 编辑器有侧栏、滚动容器、缩放和选中框，部分浏览器打印时会只生成 1 页空白。
 * 这里克隆每页 DOM，放进一个干净的 about:blank 窗口，再调用 print()。
 */
export function openPrintPreview({ w, h, orientation, bw }: PrintOptions): HTMLElement {
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((n) => n.outerHTML)
    .join('\n')

  const pages = Array.from(document.querySelectorAll<HTMLElement>('.ed-page-wrap')).map((wrap) => {
    const clone = wrap.cloneNode(true) as HTMLElement
    clone.classList.remove('is-active', 'is-drop-target', 'is-last')
    clone.style.width = ''
    clone.style.height = ''
    clone.querySelectorAll('.ed-handle, .ed-page-tag, .ed-page-drop-hint, .ed-grid, .ed-band').forEach((n) => n.remove())
    clone.querySelectorAll('.ed-el.is-selected, .ed-el.is-editing, .ed-el.is-dragging').forEach((n) => {
      n.classList.remove('is-selected', 'is-editing', 'is-dragging')
    })
    clone.querySelectorAll('.is-sub-selected').forEach((n) => n.classList.remove('is-sub-selected'))
    return clone.outerHTML
  }).join('')

  const printCss = `
    @page { size: A4 ${orientation}; margin: 0; }
    html, body {
      margin: 0 !important; padding: 0 !important;
      width: auto !important; height: auto !important;
      background: #fff !important; overflow: visible !important;
    }
    body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; }
    .ed-page-wrap {
      position: relative !important; margin: 0 !important; padding: 0 !important;
      width: ${w}px !important; height: ${h}px !important;
      box-shadow: none !important; outline: none !important;
      page-break-after: always; break-after: page;
      page-break-inside: avoid; break-inside: avoid;
    }
    .ed-page-wrap:last-child { page-break-after: auto; break-after: auto; }
    .ed-page {
      width: ${w}px !important; height: ${h}px !important;
      margin: 0 !important; transform: none !important;
      position: relative !important; overflow: hidden !important;
      background: #fff !important;
      page-break-inside: avoid; break-inside: avoid;
    }
    .ed-toolbar, .ed-formatbar, .ed-palette, .ed-inspector, .ed-side, .ed-side-toggle,
    .ed-canvas-bar, .ed-page-tag, .ed-page-drop-hint, .ed-add-page, .ed-page-count,
    .ed-drop-badge, .ed-drop-new-page, .ed-drag-ghost, .ed-print-pop { display: none !important; }
    .ed-grid, .ed-band { display: none !important; }
    .ed-handle { display: none !important; }
    .ed-el.is-selected, .ed-el.is-editing, .ed-el.is-dragging { outline: none !important; }
    .ed-page, .ed-page * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { background: #e9e9e9; }
    .print-preview-bar {
      position: sticky; top: 0; z-index: 100;
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      padding: 10px 16px; background: #2f2f2f; color: #fff;
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    .print-preview-bar strong { font-size: 14px; margin-right: 10px; }
    .print-preview-bar span { font-size: 11px; color: #bbb; }
    .print-preview-bar .actions { display: flex; gap: 8px; }
    .print-preview-bar button {
      padding: 6px 14px; border: 1px solid #5a5a5a; border-radius: 4px;
      background: #464646; color: #eee; font-size: 12px; cursor: pointer;
    }
    .print-preview-bar button.primary { background: #1677ff; border-color: #1677ff; color: #fff; font-weight: 700; }
    .ed-page-wrap { margin: 18px auto !important; box-shadow: 0 2px 14px rgba(0,0,0,.18); }
    ${bw ? '.ed-page { filter: grayscale(1) contrast(1.04); }' : ''}
    @media print {
      body { background: #fff !important; }
      .print-preview-bar { display: none !important; }
      .ed-page-wrap { margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
      .ed-page { border-radius: 0 !important; }
    }
  `

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <base href="${document.baseURI}">
    <title>打印预览</title>
    ${styles}
    <style>${printCss}</style>
  </head><body>
    <div class="print-preview-bar">
      <div><strong>打印预览</strong><span>${orientation === 'landscape' ? 'A4 横向' : 'A4 纵向'} · ${bw ? '黑白' : '彩色'} · 共 ${Array.from(document.querySelectorAll('.ed-page-wrap')).length} 页</span></div>
      <div class="actions">
        <button id="print-close">关闭</button>
        <button id="print-go" class="primary">打印 / 保存 PDF</button>
      </div>
    </div>
    ${pages}
    <script>
      document.getElementById('print-go').onclick = () => window.print();
      document.getElementById('print-close').onclick = () => {
        if (window.parent && window.parent !== window) {
          window.parent.document.getElementById('ed-print-preview')?.remove();
        } else {
          window.close();
        }
      };
    </script>
  </body></html>`

  document.getElementById('ed-print-preview')?.remove()
  const host = document.createElement('div')
  host.id = 'ed-print-preview'
  host.style.cssText = 'position:fixed;inset:0;z-index:200000;background:#e9e9e9;'
  const frame = document.createElement('iframe')
  frame.title = '打印预览'
  frame.style.cssText = 'width:100%;height:100%;border:0;background:#e9e9e9;display:block;'
  frame.srcdoc = html
  host.appendChild(frame)
  document.body.appendChild(host)
  frame.addEventListener('load', () => frame.contentWindow?.focus())
  return host
}
