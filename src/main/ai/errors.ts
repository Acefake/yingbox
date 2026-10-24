/**
 * AI 调用的错误类型。message 带 `[ai:<code>]` 前缀，跨 IPC 后渲染层仍能取回错误码。
 */
import { type AiErrorCode, formatAiErrorMessage } from '../../shared/ai/types'

/** AI 调用失败 */
export class AiError extends Error {
  readonly code: AiErrorCode
  /** HTTP 状态码（code 为 http 时） */
  readonly status?: number
  /** 是否值得重试（429 / 5xx / 网络抖动） */
  readonly retryable: boolean
  /** 服务商建议的重试等待（毫秒，来自 Retry-After） */
  readonly retryAfterMs?: number

  constructor(
    code: AiErrorCode,
    message: string,
    options: {
      status?: number
      retryable?: boolean
      retryAfterMs?: number
    } = {}
  ) {
    super(formatAiErrorMessage(code, message))
    this.name = 'AiError'
    this.code = code
    this.status = options.status
    this.retryable = options.retryable ?? false
    this.retryAfterMs = options.retryAfterMs
  }
}

/** HTTP 状态码是否值得重试 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500
}

/** 把 HTTP 错误响应转成 AiError（尽量取服务商给的错误说明） */
export function httpError(
  status: number,
  bodyText: string,
  retryAfter: string | null
): AiError {
  let detail = ''
  try {
    const body = JSON.parse(bodyText) as {
      error?: { message?: unknown } | string
      message?: unknown
    }
    const raw =
      typeof body.error === 'string'
        ? body.error
        : (body.error?.message ?? body.message)
    if (typeof raw === 'string') detail = raw
  } catch {
    detail = bodyText.slice(0, 200)
  }
  const hint =
    status === 401 || status === 403
      ? 'API Key 无效或没有权限'
      : status === 404
        ? '接口地址或模型不存在'
        : status === 429
          ? '请求太频繁或额度不足'
          : `服务商返回 ${status}`
  const seconds = retryAfter ? Number(retryAfter) : NaN
  return new AiError('http', detail ? `${hint}：${detail}` : hint, {
    status,
    retryable: isRetryableStatus(status),
    retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : undefined,
  })
}

/**
 * 流式响应里的错误事件（HTTP 200 但 data: {"error":…}）转成 AiError。
 * error.code / status 是数字时按 HTTP 状态处理（决定能否重试），否则记为 bad_response。
 */
export function streamError(
  raw: { message?: unknown; code?: unknown; status?: unknown } | string
): AiError {
  const detail =
    typeof raw === 'string'
      ? raw
      : typeof raw.message === 'string'
        ? raw.message
        : ''
  const code = typeof raw === 'string' ? NaN : Number(raw.code ?? raw.status)
  const message = detail
    ? `AI 接口在流式响应中报错：${detail.slice(0, 200)}`
    : 'AI 接口在流式响应中报错'
  if (Number.isInteger(code) && code >= 400 && code <= 599)
    return new AiError('http', message, {
      status: code,
      retryable: isRetryableStatus(code),
    })
  return new AiError('bad_response', message)
}
