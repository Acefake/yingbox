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
    const message =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail
              .map(item => (typeof item?.msg === 'string' ? item.msg : ''))
              .filter(Boolean)
              .join('；')
          : ''
    throw new Error(
      `Amane 请求失败（${context}）${message ? `：${message}` : '，请检查 Amane 后台日志'}`
    )
  }
  return data
}
