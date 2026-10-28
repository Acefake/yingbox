/**
 * Cloudflare 一类防护页的识别。引擎（插件 $fetch、下载源）与主进程浏览器代抓共用。
 *
 * 两种防护页要分开处理：
 * - 挑战页（challenge）：「Just a moment…」、cf_chl_opt 等。真实浏览器执行完脚本就能通过，
 *   值得交给主进程开窗口代抓。
 * - 硬封锁（blocked）：「Sorry, you have been blocked」、Error 1020/1005/1006/1009/1015、
 *   Access denied 等。按 IP / 地区 / 规则拒绝，浏览器也过不去，开窗口只会白白打扰用户。
 */

/** 页面判定：正常、可通过的挑战、硬封锁。 */
export type PageVerdict = 'ok' | 'challenge' | 'blocked'

/**
 * 硬封锁标记。cf-error-code 只出现在 Cloudflare 的错误页（1xxx 封禁、5xx 源站故障），
 * 两类都不是浏览器能通过的。Access denied 只认 <title>，避免误伤正文里的同名文字。
 */
const BLOCKED_PATTERNS: readonly RegExp[] = [
  /Sorry, you have been blocked/i,
  /You are unable to access/i,
  /class="cf-error-code"/i,
  /cf-error-details/i,
  /Error (?:1005|1006|1007|1008|1009|1012|1015|1020)\b/,
  /<title>\s*Access denied/i,
  /\b10(?:05|06|09|12|15|20): Access denied/,
]

/**
 * 挑战标记。「Attention Required! | Cloudflare」既用于旧版验证码挑战，也用于封锁页，
 * 只有在没有封锁标记时才算挑战。
 */
const CHALLENGE_PATTERNS: readonly RegExp[] = [
  /Just a moment/,
  /Enable JavaScript and cookies to continue/,
  /cf_chl_opt/,
  /cf-chl-/,
  /cf-browser-verification/,
  /challenge-platform/,
  /Attention Required! \| Cloudflare/,
  /安全验证/,
]

/** 判定页面类型；非字符串一律算正常（JSON 已解析等）。封锁优先于挑战。 */
export function classifyPage(data: unknown): PageVerdict {
  if (typeof data !== 'string' || !data) return 'ok'
  if (BLOCKED_PATTERNS.some(re => re.test(data))) return 'blocked'
  if (CHALLENGE_PATTERNS.some(re => re.test(data))) return 'challenge'
  return 'ok'
}

/** 是否可通过的挑战页（硬封锁不算）。 */
export const isChallengePage = (data: unknown): boolean =>
  classifyPage(data) === 'challenge'

/** 是否硬封锁页。 */
export const isBlockedPage = (data: unknown): boolean =>
  classifyPage(data) === 'blocked'
