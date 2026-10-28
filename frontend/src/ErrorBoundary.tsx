import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: string
}

/**
 * 全局错误兜底：任何渲染异常都不再是“白屏”，
 * 而是给出可操作面板（重载 / 清空本地存档 / 导出存档排查）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[paiban] 渲染异常', error, info.componentStack)
    this.setState({ info: info.componentStack ?? '' })
  }

  private reload = () => {
    window.location.reload()
  }

  private resetStorage = () => {
    try {
      localStorage.removeItem('paiban-editor-doc-v1')
    } catch {
      /* 忽略 */
    }
    window.location.reload()
  }

  private exportStorage = () => {
    try {
      const raw = localStorage.getItem('paiban-editor-doc-v1') ?? '{}'
      const blob = new Blob([raw], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'paiban-损坏存档.json'
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      /* 忽略 */
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="ed-fatal">
        <div className="ed-fatal-card">
          <h1>版面加载失败</h1>
          <p>页面没有正常渲染，通常是本地存档损坏或版本不兼容导致的。你的内容仍可能保存在浏览器本地。</p>
          <pre>{error.message}</pre>
          <div className="ed-fatal-actions">
            <button onClick={this.reload}>重新加载</button>
            <button onClick={this.resetStorage}>清空本地存档并重载</button>
            <button onClick={this.exportStorage}>导出损坏存档</button>
          </div>
          <p className="ed-fatal-hint">
            如果刷新后仍然白屏：请使用 <code>pnpm dev</code> 打开页面，或双击构建后的
            <code>dist/地理周刊-排版编辑器.html</code>（单文件版）。
          </p>
        </div>
      </div>
    )
  }
}
