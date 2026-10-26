/** 极简 Node 内置模块类型声明（项目未安装 @types/node，仅供 vite.config.ts 使用） */

declare module 'node:fs/promises' {
  export function readFile(path: string): Promise<Uint8Array>
}

declare module 'node:path' {
  const path: {
    posix: { normalize(p: string): string }
    extname(p: string): string
  }
  export default path
}

/** 本机 Word 导入插件（tools/import/，纯 Node ESM，不参与前端构建） */
declare module '*/tools/import/server-plugin.mjs' {
  import type { Plugin } from 'vite'
  export function docImportPlugin(): Plugin
}
