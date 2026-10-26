import type { Orientation } from './types'

interface PrintOptions {
  w: number
  h: number
  orientation: Orientation
  /** 初始配色。默认彩色；打开后可在弹窗里随时切换 */
  bw?: boolean
}

/**
 * 打开打印预览。
 *
 * 形态：居中的大弹窗（类似系统打印预览），而不是铺满全屏。
 * 外层遮罩在宿主页面，弹窗本身在 iframe 里 —— 保留 iframe 的原因有两个：
 *   1. 打印只输出 iframe 这一份干净文档，不会把工具栏/侧栏/选中框带出去；
 *   2. @page 与打印媒体规则只作用于 iframe，不污染编辑器。
 *
 * 彩色/黑白是弹窗内的切换（标题栏分段按钮），不再需要点按钮前先选模式。
 */
export function openPrintPreview({ w, h, orientation, bw = false }: PrintOptions): HTMLElement {
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((n) => n.outerHTML)
    .join('\n')

  const wraps = Array.from(document.querySelectorAll<HTMLElement>('.ed-page-wrap'))
  const pages = wraps
    .map((wrap) => {
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
    })
    .join('')

  const pageLabel = orientation === 'landscape' ? 'A4 横向' : 'A4 纵向'

  const printCss = `
    @page { size: A4 ${orientation}; margin: 0; }
    html, body {
      margin: 0 !important; padding: 0 !important;
      width: auto !important;
      background: #fff !important;
    }
    /* 弹窗要撑满 iframe 视口：html 必须给定高度，否则 body 的 100% 无从计算 */
    html { height: 100% !important; }
    body {
      height: 100% !important; overflow: hidden !important;
      font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #eef1f5 !important;
      color: #1f2937;
    }
    /* ---------- 弹窗骨架 ---------- */
    .pv-dialog {
      height: 100%; display: flex; flex-direction: column;
      background: #eef1f5;
    }
    .pv-head {
      display: flex; align-items: center; gap: 10px;
      padding: 12px 16px;
      background: #fbfcfe;
      border-bottom: 1px solid #dfe3ea;
    }
    .pv-head .pv-dot { width: 8px; height: 8px; border-radius: 50%; background: #1677ff; flex: none; }
    .pv-title { font-size: 14px; font-weight: 700; letter-spacing: 0.3px; }
    .pv-meta { font-size: 11px; color: #7c8698; margin-right: auto; }
    /* 彩色 / 黑白：分段按钮，切换只改画面，不改页数 */
    .pv-seg {
      display: flex; flex: none;
      border: 1px solid #d7dde6; border-radius: 8px; overflow: hidden; background: #fff;
    }
    .pv-seg button {
      padding: 5px 12px; font-size: 12px; border: 0; background: transparent;
      color: #4b5563; cursor: pointer; font-family: inherit;
    }
    .pv-seg button + button { border-left: 1px solid #e3e8ef; }
    .pv-seg button:hover { background: #f2f6fc; }
    .pv-seg button.is-on { background: #1677ff; color: #fff; font-weight: 700; }
    .pv-x {
      width: 28px; height: 28px; flex: none;
      border: 1px solid #dfe3ea; border-radius: 8px;
      background: #fff; color: #59637a; font-size: 15px; line-height: 1; cursor: pointer;
    }
    .pv-x:hover { background: #f2f5f9; border-color: #c3cbd8; color: #1f2937; }
    .pv-body { flex: 1; min-height: 0; overflow: auto; padding: 22px 28px; }
    .pv-pages { display: flex; flex-direction: column; align-items: center; gap: 18px; }
    .pv-foot {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px;
      background: #fbfcfe;
      border-top: 1px solid #dfe3ea;
    }
    .pv-hint { font-size: 11px; color: #8a93a3; }
    .pv-actions { margin-left: auto; display: flex; gap: 8px; }
    .pv-actions button {
      padding: 7px 16px; border-radius: 8px; font-size: 12.5px; cursor: pointer;
      border: 1px solid #d7dde6; background: #fff; color: #374151;
    }
    .pv-actions button:hover { background: #f3f6fa; }
    .pv-actions button.primary {
      background: #1677ff; border-color: #1677ff; color: #fff; font-weight: 700;
    }
    .pv-actions button.primary:hover { background: #0f62e6; }

    /* ---------- 纸张 ---------- */
    .ed-page-wrap {
      position: relative !important; margin: 0 !important; padding: 0 !important;
      width: ${w}px !important; height: ${h}px !important;
      box-shadow: 0 3px 14px rgba(24, 39, 75, 0.16) !important;
      outline: none !important;
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
    /* 黑白预览由 body.is-bw 驱动，弹窗里随时可切；打印时同样生效 */
    body.is-bw .ed-page { filter: grayscale(1) contrast(1.04); }

    /* ---------- 打印：只留纸张 ---------- */
    @media print {
      html, body, .pv-dialog, .pv-body, .pv-pages { height: auto !important; display: block !important; overflow: visible !important; }
      body { background: #fff !important; }
      .pv-head, .pv-foot { display: none !important; }
      .pv-body { padding: 0 !important; }
      .pv-pages { zoom: 1 !important; display: block !important; }
      .ed-page-wrap { margin: 0 !important; box-shadow: none !important; border-radius: 0 !important; }
      .ed-page { border-radius: 0 !important; }
    }
  `

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <base href="${document.baseURI}">
    <title>打印预览</title>
    ${styles}
    <style>${printCss}</style>
  </head><body class="${bw ? 'is-bw' : ''}">
    <div class="pv-dialog">
      <div class="pv-head print-preview-bar">
        <span class="pv-dot"></span>
        <span class="pv-title">打印预览</span>
        <span class="pv-meta">${pageLabel} · <span id="pv-mode-label">${bw ? '黑白' : '彩色'}</span> · 共 ${wraps.length} 页</span>
        <div class="pv-seg" role="group" aria-label="配色">
          <button id="pv-mode-color" class="${bw ? '' : 'is-on'}">彩色</button>
          <button id="pv-mode-bw" class="${bw ? 'is-on' : ''}">黑白</button>
        </div>
        <button class="pv-x" id="print-close" title="关闭预览（Esc）">✕</button>
      </div>
      <div class="pv-body" id="pv-body">
        <div class="pv-pages" id="pv-pages">${pages}</div>
      </div>
      <div class="pv-foot">
        <span class="pv-hint">缩放 <b id="pv-zoom">100%</b> · 在系统打印面板里可「另存为 PDF」</span>
        <div class="pv-actions">
          <button id="print-cancel">取消</button>
          <button id="print-go" class="primary">打印 / 保存 PDF</button>
        </div>
      </div>
    </div>
    <script>
      (function () {
        var PAGE_W = ${w}, PAGE_H = ${h};
        var body = document.getElementById('pv-body');
        var stack = document.getElementById('pv-pages');
        var zoomLabel = document.getElementById('pv-zoom');
        // 按「整页可见」缩放：宽高都放得下，和系统打印预览一样一眼看到整版
        function fit() {
          var availW = body.clientWidth - 8;
          var availH = body.clientHeight - 44;
          var s = Math.min(1, availW / PAGE_W, availH / PAGE_H);
          s = Math.max(0.2, s);
          stack.style.zoom = String(s);
          if (zoomLabel) zoomLabel.textContent = Math.round(s * 100) + '%';
        }
        fit();
        window.addEventListener('resize', fit);

        function close() {
          if (window.parent && window.parent !== window) {
            window.parent.document.getElementById('ed-print-preview')?.remove();
          } else {
            window.close();
          }
        }

        /* 彩色 / 黑白：只切 body class，画面与打印输出同步变，不影响页数 */
        var colorBtn = document.getElementById('pv-mode-color');
        var bwBtn = document.getElementById('pv-mode-bw');
        var modeLabel = document.getElementById('pv-mode-label');
        function setMode(isBw) {
          document.body.classList.toggle('is-bw', isBw);
          colorBtn.classList.toggle('is-on', !isBw);
          bwBtn.classList.toggle('is-on', isBw);
          if (modeLabel) modeLabel.textContent = isBw ? '黑白' : '彩色';
        }
        colorBtn.onclick = function () { setMode(false); };
        bwBtn.onclick = function () { setMode(true); };

        document.getElementById('print-close').onclick = close;
        document.getElementById('print-cancel').onclick = close;
        document.getElementById('print-go').onclick = function () { window.print(); };
        window.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.preventDefault(); close(); }
        });
      })();
    </script>
  </body></html>`

  document.getElementById('ed-print-preview')?.remove()

  const host = document.createElement('div')
  host.id = 'ed-print-preview'
  host.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:200000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:24px',
    'background:rgba(16,20,38,0.38)',
    '-webkit-backdrop-filter:blur(10px)',
    'backdrop-filter:blur(10px)',
  ].join(';')

  const frame = document.createElement('iframe')
  frame.title = '打印预览'
  frame.style.cssText = [
    'display:block',
    'width:min(1280px,94vw)',
    'height:min(900px,90vh)',
    'border:1px solid rgba(255,255,255,0.7)',
    'border-radius:20px',
    'overflow:hidden',
    'background:#eef1f5',
    'box-shadow:0 32px 90px rgba(20,27,68,0.34)',
  ].join(';')
  frame.srcdoc = html
  host.appendChild(frame)

  const close = () => {
    document.removeEventListener('keydown', onKey, true)
    host.remove()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }
  // 点遮罩关闭；点弹窗内部不会触发（iframe 的事件不会冒泡到宿主文档）
  host.addEventListener('pointerdown', (e) => {
    if (e.target === host) close()
  })
  document.addEventListener('keydown', onKey, true)

  document.body.appendChild(host)
  frame.addEventListener('load', () => frame.contentWindow?.focus())
  return host
}
