import { createRoot } from 'react-dom/client'
import { Notice, type NoticeData } from './Notice'

interface ConfirmOptions extends Omit<NoticeData, 'actions'> {
  okLabel?: string
  cancelLabel?: string
}

/** 轻量提示（只有一个「知道了」）；autoClose>0 时到点自动关 */
export function popNotice(opts: ConfirmOptions & { autoClose?: number }): void {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let done = false
  const close = () => {
    if (done) return
    done = true
    setTimeout(() => {
      root.unmount()
      host.remove()
    }, 0)
  }
  root.render(<Notice data={opts} onClose={close} />)
  if (opts.autoClose) setTimeout(close, opts.autoClose)
}

/**
 * 命令式确认框（替代原生 confirm）。
 * 用法：`if (await confirmNotice({ title: '删除当前页？', tone: 'warn' })) …`
 * 与 Notice 同一套玻璃态视觉，Esc / 遮罩 / 取消都返回 false。
 */
export function confirmNotice(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let done = false
    const close = (ok: boolean) => {
      if (done) return
      done = true
      // unmount 放到下一帧：onClick 回调还在本次渲染事务里
      setTimeout(() => {
        root.unmount()
        host.remove()
      }, 0)
      resolve(ok)
    }
    root.render(
      <Notice
        data={{
          ...opts,
          actions: [
            { label: opts.cancelLabel ?? '取消', onClick: () => close(false) },
            { label: opts.okLabel ?? '确定', primary: true, onClick: () => close(true) },
          ],
        }}
        onClose={() => close(false)}
      />,
    )
  })
}
