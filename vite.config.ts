import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { docImportPlugin } from './tools/import/server-plugin.mjs'

/** ESM 里没有 __dirname，用它把相对路径钉成绝对路径 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

interface LocalReq {
  url?: string
}

interface LocalRes {
  statusCode: number
  setHeader(name: string, value: string): void
  end(body?: unknown): void
}

/**
 * 开发期本地图片支持：
 * 页面里 <img src="/@local/Users/xxx/img1.png"> → 直接读本机磁盘文件
 * （浏览器不允许 http 页面加载 file:// 资源，故由开发服务器代读）
 */
function localImages(): Plugin {
  const handler = async (req: LocalReq, res: LocalRes) => {
    try {
      const url = decodeURIComponent((req.url ?? '').split('?')[0])
      // Windows 盘符路径（C:/Users/...）走 win32 语义，其余（/Users/...）走 posix
      const isWinPath = /^[A-Za-z]:[\\/]/.test(url)
      const abs = isWinPath ? path.win32.normalize(url) : path.posix.normalize(url)
      const absolute = isWinPath ? path.win32.isAbsolute(abs) : abs.startsWith('/')
      if (!absolute || abs.includes('..')) {
        res.statusCode = 400
        res.end('bad path')
        return
      }
      const ext = path.extname(abs).toLowerCase()
      if (!MIME[ext]) {
        res.statusCode = 415
        res.end('unsupported file type')
        return
      }
      const data = await fs.readFile(abs)
      res.setHeader('Content-Type', MIME[ext])
      res.setHeader('Cache-Control', 'no-cache')
      res.end(data)
    } catch {
      res.statusCode = 404
      res.end('local image not found')
    }
  }
  return {
    name: 'local-images',
    configureServer(server) {
      server.middlewares.use('/@local', handler as never)
    },
    // vite preview 也支持本地图片代理，否则 build 后预览时 file:// 图片仍然不显示
    configurePreviewServer(server) {
      server.middlewares.use('/@local', handler as never)
    },
  }
}

export default defineConfig({
  // 相对资源路径：dist 既能放到任意子目录，也便于构建后内联成单文件
  base: './',
  plugins: [react(), localImages(), docImportPlugin()],
  build: {
    rollupOptions: {
      input: {
        // 编辑器主界面
        main: here('index.html'),
        // 服务器端自动装配页（部署后由无头 Chromium 打开，不给人看）
        format: here('format.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
