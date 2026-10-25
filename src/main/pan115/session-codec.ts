/**
 * 115 会话在 safeStorage 密钥 pan115.session 里的编码：JSON { cookie, userId, userName }。
 */
import type { Pan115Session } from './client'

/** 读保存的会话；空串、坏 JSON、缺 cookie 时为 null */
export function parseSession(raw: string): Pan115Session | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<Pan115Session>
    return typeof data.cookie === 'string' && data.cookie
      ? {
          cookie: data.cookie,
          userId: String(data.userId ?? ''),
          userName: String(data.userName ?? ''),
        }
      : null
  } catch {
    return null
  }
}

/** 会话 → 密钥内容；null（退出）为空串 */
export function serializeSession(session: Pan115Session | null): string {
  return session ? JSON.stringify(session) : ''
}
