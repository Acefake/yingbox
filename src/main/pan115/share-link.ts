/**
 * 115 分享链接解析：115.com / 115cdn.com / anxia.com 的 /s/<分享码>，
 * 提取码取自 ?password=、文字里的「提取码 / 访问码 / 密码」，最后才用单独给的密码。
 */

/** 分享码 + 提取码 */
export interface ShareRef {
  shareCode: string
  /** 没有时为空串 */
  receiveCode: string
}

const LINK =
  /(?:^|[^a-z0-9.-])(?:www\.)?(?:115|115cdn|anxia)\.com\/s\/([a-z0-9]+)/i
const PASSWORD_PARAM = /[?&#]password=([a-z0-9]{4})/i
const PASSWORD_TEXT = /(?:提取码|访问码|密码)\s*[:：=]?\s*([a-z0-9]{4})/i

/** 从链接（或含链接的一段文字）里解析分享；不是 115 分享时返回 null */
export function parseShareLink(text: string, password = ''): ShareRef | null {
  const link = LINK.exec(text)
  if (!link) return null
  const receiveCode =
    PASSWORD_PARAM.exec(text)?.[1] ??
    PASSWORD_TEXT.exec(text)?.[1] ??
    password.trim()
  return { shareCode: link[1], receiveCode }
}
