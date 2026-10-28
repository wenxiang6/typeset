import { useEffect, useState } from 'react'
import { EditorApp } from './editor/Editor'
import { NewspaperApp } from './newspaper/Newspaper'
import { WordReplicaApp } from './WordReplicaApp'

/**
 * 路由：
 * - 默认 `/`        排版编辑器（模板可编辑、组件拖拽、格式栏、网格与区域约束）
 * - `/#/preview`    报纸版只读预览（可直接打印/导出 PDF）
 * - `/#/word`       1:1 复刻版（按原 Word 文档截图还原）
 */
export default function App() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (hash === '#/word') return <WordReplicaApp />
  if (hash === '#/preview') return <NewspaperApp />
  return <EditorApp />
}
