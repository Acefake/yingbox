/**
 * Amane 响应解析：204 → null；非 JSON 或非 2xx 时抛出带 HTTP 状态与接口路径（不含查询串）的错误。
 */
import { errorDetail } from './rules'

/** 读完响应体并解析 JSON；失败时错误信息带上状态码与接口路径 */
export async function readAmaneResponse(
  response: Response,
  path: string
): Promise<unknown> {
  if (response.status === 204) return null
  // Query strings can contain user input; report only the endpoint.
  const endpoint = path.split('?')[0]
  const context = `HTTP ${response.status}，${endpoint}`
  const text = await response.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(
      response.ok
        ? `Amane 返回了无效的 JSON（${context}）`
        : `Amane 请求失败（${context}），请检查 Amane 后台日志`
    )
  }
  if (!response.ok) {
    const detail =
      data && typeof data === 'object' && 'detail' in data
        ? data.detail
        : undefined
    const message = errorDetail(detail)
    throw new Error(
      `Amane 请求失败（${context}）${message ? `：${message}` : '，请检查 Amane 后台日志'}`
    )
  }
  return data
}
