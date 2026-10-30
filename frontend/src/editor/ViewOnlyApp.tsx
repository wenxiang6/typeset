/**
 * 只读预览（/view?u=&k=）——分享链接的落点。
 *
 * 复用编辑器的渲染与分页管线（数据加载逻辑同一套：本机没有存档而服务器有 → 拉服务器），
 * 只是把编辑外壳（工具栏/组件库/属性面板/格式栏）全部藏掉、纸张禁交互，
 * 加一个悬浮条：打印 / 导出 PDF。
 */

import { EditorApp } from './Editor'

export default function ViewOnlyApp() {
  return (
    <div className="vo-root">
      <style>{viewOnlyCss}</style>
      <div className="vo-banner">
        <span>只读预览 · 由分享链接打开</span>
        <button className="vo-print" onClick={() => window.print()}>
          打印 / 导出 PDF
        </button>
      </div>
      <EditorApp />
    </div>
  )
}

const viewOnlyCss = `
.vo-root .ed-app > :not(.ed-body) { display: none !important; }
.vo-root .ed-side { display: none !important; }
.vo-root .ed-canvas-bar { display: none !important; }
.vo-root .ed-canvas, .vo-root .ed-canvas * { pointer-events: none !important; }
.vo-root .ed-app { padding-top: 0 !important; }
@media print {
  .vo-banner { display: none !important; }
}
.vo-banner {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  background: #111;
  color: #fff;
  font: 13px system-ui, sans-serif;
}
.vo-print {
  font: 13px system-ui;
  padding: 4px 14px;
  border: none;
  border-radius: 6px;
  background: #185FA5;
  color: #fff;
  cursor: pointer;
}
`
