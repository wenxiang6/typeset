/**
 * 预加载脚本（沙箱下只能是 CommonJS）
 *
 * 只做一件事：把「菜单点了 打印预览 / 打开 JSON」转给渲染进程。
 * 不暴露任何 Node 能力，渲染进程依旧跑在 sandbox 里。
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('paibanDesktop', {
  version: process.env.PAIBAN_VERSION || '',
  platform: process.platform,
  onPrint: (cb) => {
    ipcRenderer.on('paiban:print', () => cb())
  },
  onOpenJson: (cb) => {
    ipcRenderer.on('paiban:open-json', () => cb())
  },
})
