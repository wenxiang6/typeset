/**
 * Electron 主进程
 *
 * 启动流程：本地 HTTP 服务（127.0.0.1 随机端口）→ 窗口加载该地址。
 * 之所以不用 file:// 直接开 dist/index.html：
 * - 页面里 fetch('/@doc-import') 需要 http 源
 * - 导入图片 / 本地磁盘图片都要经过一层按白名单读盘的代理
 * 服务只监听回环地址，不对外暴露、不联网。
 */
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const isMac = process.platform === 'darwin'

let win = null
let server = null
/** server.mjs 是 ESM，延迟到启动时再 import */
let startServer = null

/* —— 窗口大小 / 位置记忆（不引依赖，一个 JSON 搞定） —— */
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json')

function loadWindowBounds() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
    if (s && typeof s.width === 'number' && typeof s.height === 'number') return s
  } catch {
    /* 没有历史记录，用默认值 */
  }
  return null
}

function saveWindowBounds() {
  if (!win || win.isMinimized() || win.isFullScreen()) return
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(win.getBounds()))
  } catch {
    /* 写不进去就算了 */
  }
}

/** 单实例：再次启动时把已有窗口提到前面 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

function appFiles() {
  const appRoot = app.getAppPath()
  return {
    distDir: path.join(appRoot, 'dist'),
    // 导入的图片写到 userData，而不是程序目录（asar 只读）
    imagesDir: path.join(app.getPath('userData'), 'imported'),
    tmpDir: os.tmpdir(),
  }
}

function buildMenu() {
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about', label: `关于 ${app.name}` },
            { type: 'separator' },
            { role: 'hide', label: '隐藏' },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '显示全部' },
            { type: 'separator' },
            { role: 'quit', label: '退出' },
          ],
        }]
      : []),
    {
      label: '文件',
      submenu: [
        {
          label: '打开版面 JSON…',
          accelerator: 'CmdOrCtrl+O',
          click: () => win?.webContents.send('paiban:open-json'),
        },
        { type: 'separator' },
        {
          label: '打印预览',
          accelerator: 'CmdOrCtrl+P',
          click: () => win?.webContents.send('paiban:print'),
        },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '打开存档目录',
          click: () => shell.openPath(app.getPath('userData')),
        },
        {
          label: '关于导入 Word 的说明',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: '导入 Word',
              message: '导入在本机完成，不联网',
              detail:
                `· macOS：用系统自带的 textutil 转 HTML\n` +
                `· Windows：依次尝试 Word / WPS / LibreOffice（需装其中一个）\n\n` +
                `导入的图片存放在：\n${path.join(app.getPath('userData'), 'imported')}`,
              buttons: ['好'],
            }),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow() {
  const files = appFiles()
  if (!fs.existsSync(files.distDir)) {
    dialog.showErrorBox('缺少 dist', '没有找到 dist 目录，请先执行 pnpm build 再启动桌面版。')
    app.quit()
    return
  }
  if (!startServer) ({ startServer } = await import('./server.mjs'))
  // SQLite 持久化：存档/快照/模板库存到用户目录，换浏览器/重装应用都不丢
  files.dbPath = path.join(app.getPath('userData'), 'paiban.db')
  server = await startServer({ ...files, log: (m) => console.log(m) })

  const saved = loadWindowBounds()
  win = new BrowserWindow({
    width: saved?.width ?? 1500,
    height: saved?.height ?? 950,
    x: typeof saved?.x === 'number' ? saved.x : undefined,
    y: typeof saved?.y === 'number' ? saved.y : undefined,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#eef1f5',
    title: '地理周刊排版',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // 站外链接交给系统浏览器；站内窗口（#/preview、#/word）留在应用里
  const origin = server.url.replace(/\/$/, '')
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin) || url.startsWith('#')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 1280, height: 900, backgroundColor: '#eef1f5' },
      }
    }
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(origin)) return
    e.preventDefault()
    void shell.openExternal(url)
  })

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('页面加载失败', code, desc)
  })

  await win.loadURL(server.url)
  if (process.env.PAIBAN_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' })
}

app.whenReady().then(async () => {
  if (!fs.existsSync(appFiles().distDir)) {
    dialog.showErrorBox('缺少 dist', '没有找到 dist 目录，请先执行 pnpm build 再启动桌面版。')
    app.quit()
    return
  }
  buildMenu()

  // 一键导出 PDF：printToPDF 直接落盘，不用过系统打印面板
  ipcMain.handle('paiban:export-pdf', async (e, opts = {}) => {
    const sender = BrowserWindow.fromWebContents(e.sender) ?? win
    if (!sender) return { ok: false, error: 'no window' }
    const { canceled, filePath } = await dialog.showSaveDialog(sender, {
      title: '导出 PDF',
      defaultPath: `地理周刊-${new Date().toISOString().slice(0, 10)}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    const buf = await sender.webContents.printToPDF({
      printBackground: true,
      landscape: Boolean(opts.landscape),
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    })
    fs.writeFileSync(filePath, buf)
    return { ok: true, filePath }
  })

  await createWindow()

  // 关窗时记一下窗口大小 / 位置
  win.on('close', saveWindowBounds)

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow()
  })
})

app.on('window-all-closed', async () => {
  if (isMac) return
  await server?.close().catch(() => {})
  app.quit()
})

app.on('before-quit', async () => {
  await server?.close().catch(() => {})
})
