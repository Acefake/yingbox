/**
 * 私密技能包的纯规则：番号规整、在查询结果里认出同一番号、条目 → 卡片说明。不依赖 Vue / IPC。
 */

/** 番号库所在的板块与路由 */
export const PRIVATE_LIBRARY = { section: 'jav', path: '/jav' } as const

/**
 * 私密库自然语言搜索的跳转 query：搜索框写成「? + 描述」，并带 localOnly=1，
 * 让该页的自然语言搜索同样只发给本地模型（不看「私密板块只用本地模型」设置）。
 */
export function privateSearchQuery(text: string): Record<string, string> {
  return { q: `?${text}`, localOnly: '1' }
}

/**
 * 把各种写法的番号规整成「字母-数字」大写（abc123 / ABC_123 / abc-00123 → ABC-123）；认不出返回 null。
 * 支持 FC2-PPV-1234567 这类带两段前缀的写法。
 */
export function normalizeCode(raw: string): string | null {
  const text = raw
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
  const fc2 = /^FC2-?(?:PPV-?)?(\d{5,8})$/.exec(text)
  if (fc2) return `FC2-PPV-${fc2[1]}`
  const match = /^([A-Z]{2,6})-?0*(\d{2,5})([A-Z]?)$/.exec(text)
  if (!match) return null
  const digits = match[2].padStart(3, '0')
  return `${match[1]}-${digits}${match[3]}`
}

/** 片名里有没有这个番号（忽略大小写与分隔符） */
export function titleHasCode(title: string, code: string): boolean {
  const squash = (s: string): string =>
    s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return squash(title).includes(squash(code))
}

/** 查询结果里与番号完全对上的那一条；没有或不止一条时返回 null */
export function exactCodeMatch<T extends { title: string }>(
  items: readonly T[],
  code: string
): T | null {
  const hits = items.filter(item => titleHasCode(item.title, code))
  return hits.length === 1 ? hits[0] : null
}

/** 路由 query 里的详情条目 id；不在番号库页面或不是正整数时返回 null */
export function currentItemId(route: {
  path: string
  query: Record<string, unknown>
}): number | null {
  if (route.path !== PRIVATE_LIBRARY.path) return null
  const id = Number(route.query.item)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}
