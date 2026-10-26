/**
 * 地址栏 `?token=` 里的访问令牌。
 *
 * 启动日志打印的地址会把令牌编码好，但用户也常照文档手拼（`openssl rand -base64` 生成的令牌带 `+ / =`）：
 * 按表单规则解码时 `+` 会变成空格，令牌就对不上了。所以同时给出两种读法，调用方逐个比对。
 */

/** 地址查询串（`?a=1&token=…`）里令牌的候选读法：先按表单规则，再按「+ 是原字符」；没有令牌时为空数组。 */
export function tokenCandidates(search: string): string[] {
  const query = search.startsWith('?') ? search.slice(1) : search
  const raw = query
    .split('&')
    .find(part => part === 'token' || part.startsWith('token='))
  if (raw === undefined) return []
  const value = raw.slice('token='.length)
  const candidates = [safeDecode(value.replace(/\+/g, ' '))]
  if (value.includes('+')) candidates.push(safeDecode(value))
  return [...new Set(candidates.filter((c): c is string => Boolean(c)))]
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}
