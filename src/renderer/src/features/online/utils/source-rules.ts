/**
 * 数据源管理面板的纯规则：按连通状态排序、失效计数、自定义源校验、分类标签。
 */
export type SiteStatus = 'unknown' | 'checking' | 'ok' | 'fail'

/** 排序权重：可用 < 检测中 < 未检测 < 失效。 */
export const connectionRank = (status: SiteStatus): number =>
  status === 'ok' ? 0 : status === 'checking' ? 1 : status === 'unknown' ? 2 : 3

/** 按连通状态排序（稳定排序，同状态保持原顺序；不改原数组）。 */
export const sortByConnection = <T extends { api: string }>(
  sites: readonly T[],
  statusOf: (api: string) => SiteStatus
): T[] =>
  [...sites].sort(
    (a, b) => connectionRank(statusOf(a.api)) - connectionRank(statusOf(b.api))
  )

/** 失效的数量。 */
export const countFailed = (
  apis: readonly string[],
  statusMap: Record<string, SiteStatus>
): number => apis.filter(api => statusMap[api] === 'fail').length

/** 自定义源表单的校验结果：null 表示可以添加。 */
export type SourceInputProblem = {
  level: 'warning' | 'error' | 'info'
  text: string
}

/** 名称和地址必填、地址必须是 http(s)、不能与已知源重复。 */
export const validateCustomSource = (
  name: string,
  api: string,
  knownApis: readonly string[]
): SourceInputProblem | null => {
  if (!name || !api)
    return { level: 'warning', text: '请填写数据源名称和 API 地址' }
  try {
    const parsed = new URL(api)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
  } catch {
    return { level: 'error', text: '请输入有效的 HTTP 或 HTTPS API 地址' }
  }
  if (knownApis.includes(api))
    return { level: 'info', text: '这个数据源已经添加' }
  return null
}

export type SourceTab = 'online' | 'av'

/** 面板分类标签：AV 源只在成人模式下出现（avCount 为 null 表示不显示）。 */
export const sourceTabs = (
  onlineCount: number,
  avCount: number | null
): { value: SourceTab; label: string }[] => [
  { value: 'online', label: `在线源 ${onlineCount}` },
  ...(avCount === null
    ? []
    : [{ value: 'av' as const, label: `AV 源 ${avCount}` }]),
]
