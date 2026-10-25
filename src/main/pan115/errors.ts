/**
 * 115 / PanSou 的错误：统一成 {@link Pan115Error}，信息是给用户看的中文。
 */

/** 给用户看的错误；code 为 115 的 errno（有时），timeout 表示请求超时 */
export class Pan115Error extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly timeout = false
  ) {
    super(message)
    this.name = 'Pan115Error'
  }
}

/** 需要重新扫码的错误码（webapi 返回 99 或 990001） */
export const LOGIN_EXPIRED_CODES: readonly number[] = [99, 990001]

const MESSAGES: Record<number, string> = {
  4100024: '这个分享已经接收过了',
  4100008: '提取码不对',
  4100010: '分享已被取消',
  4100018: '分享已过期',
  911: '115 要求安全验证：请先在 115 网页或手机端完成验证后再试',
}

/** 115 errno → 人话；不认识的用 115 的原文，再没有就带上错误码 */
export function errnoMessage(errno: number, original?: string): string {
  if (LOGIN_EXPIRED_CODES.includes(errno))
    return '115 登录已失效，请在设置 · 网盘里重新扫码登录'
  return MESSAGES[errno] ?? (original?.trim() || `115 返回错误（${errno}）`)
}
