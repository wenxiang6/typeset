/** 简历排版后门 —— 入口密钥 */

/**
 * 访问后门需要在 URL 上带 ?k=<密钥>，不匹配则退回普通编辑器。
 * 例：http://127.0.0.1:5173/#/resume?k=fish8848
 */
export const RESUME_SECRET = 'fish8848'

/** 校验 URL 查询参数里的密钥是否匹配 */
export function resumeSecretOk(search: string): boolean {
  try {
    const p = new URLSearchParams(search)
    return p.get('k') === RESUME_SECRET
  } catch {
    return false
  }
}
