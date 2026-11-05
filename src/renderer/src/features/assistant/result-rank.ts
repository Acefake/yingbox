/**
 * 在线搜索结果的相关度、折叠与去重（纯规则，统一入口浮层用）。
 *
 * - 打分：片名与输入完全一致最高，开头匹配、包含次之；只共有零星几个字的算弱相关；
 *   解说、混剪、预告、资讯这类非正片一律沉到最后；
 * - 排序：分数高的在前，同分年份新的在前，再按源数量多的在前，最后保持原来的先后；
 * - 折叠：弱相关与非正片放进「更多相关」；结果本来就很少时不折叠（直接全部显示）；
 * - 去重：和本地片库同名同年（任一方缺年份时只比片名）的在线结果不再重复列出。
 */

/** 相关度达到这个分数才算正片相关结果 */
export const RELEVANT_SCORE = 50
/** 总数不超过这个值时不折叠，直接全部显示 */
export const FOLD_THRESHOLD = 3

/** 非正片：解说、混剪、预告、资讯等（按分类名或片名认） */
const NOISE = /解说|混剪|盘点|预告|花絮|影评|解析|资讯|短视频|reaction|trailer/i

/** 参与排序与去重的最小字段（OnlineRow 的子集） */
export interface RankableRow {
  title: string
  year: string
  type: string
  sources: string[]
}

/** 本地片库里的一部作品（去重用） */
export interface LocalTitle {
  title: string
  originalTitle?: string | null
  year?: number | null
}

/** 排好序、分好组的在线结果 */
export interface RankedOnline<T extends RankableRow> {
  /** 直接显示的行（相关度够的；结果很少时包含全部） */
  main: T[]
  /** 折叠起来的行（弱相关、非正片） */
  more: T[]
  /** 因与本地片库重复而去掉的条数 */
  merged: number
}

/** 片名归一：去空白与常见标点、转小写（同一套规则用于打分与去重） */
export function normalizeTitle(name: string): string {
  return name
    .replace(/[\s·・:：\-—_()（）[\]【】，,。.、!！?？《》“”"'~～]/g, '')
    .toLowerCase()
}

/** 输入里的字有多大比例出现在片名里（按字去重，不看顺序） */
function coverage(query: string, title: string): number {
  const chars = [...new Set(query)]
  if (!chars.length) return 0
  return chars.filter(ch => title.includes(ch)).length / chars.length
}

/**
 * 片名与输入的相关度 0–100（不含非正片扣分）。
 * @param query 用户输入
 * @param title 结果片名
 */
export function titleScore(query: string, title: string): number {
  const q = normalizeTitle(query)
  const t = normalizeTitle(title)
  if (!q || !t) return 0
  if (t === q) return 100
  if (t.startsWith(q)) return 90 - Math.min(t.length - q.length, 15)
  if (t.includes(q)) return 75 - Math.min(t.length - q.length, 15)
  // 输入比片名长（带了年份、季数等），片名完整出现在输入里
  if (q.includes(t) && t.length >= 2) return 70
  // 字大多出现但不连续（少打了字、颠倒、夹了标点）：算相关；只有零星几个字重合是弱相关
  const covered = coverage(q, t)
  return covered >= 0.8 ? 55 : Math.round(covered * 40)
}

/** 非正片（解说、混剪、预告、资讯…） */
export function isNoise(row: Pick<RankableRow, 'title' | 'type'>): boolean {
  return NOISE.test(row.type) || NOISE.test(row.title)
}

/** 同名同年（任一方缺年份时只比片名） */
function sameWork(
  row: Pick<RankableRow, 'title' | 'year'>,
  local: LocalTitle
): boolean {
  const key = normalizeTitle(row.title)
  const names = [local.title, local.originalTitle ?? '']
    .map(normalizeTitle)
    .filter(Boolean)
  if (!names.includes(key)) return false
  const year = Number(row.year)
  return !year || !local.year || year === local.year
}

/**
 * 排序、折叠、去重。
 * @param rows 合并后的在线结果（原始顺序）
 * @param query 用户输入
 * @param locals 本地片库已命中的作品
 */
export function rankOnline<T extends RankableRow>(
  rows: readonly T[],
  query: string,
  locals: readonly LocalTitle[] = []
): RankedOnline<T> {
  const kept = rows.filter(row => !locals.some(local => sameWork(row, local)))
  const scored = kept
    .map((row, index) => ({
      row,
      index,
      score: titleScore(query, row.title),
      noise: isNoise(row),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.row.year || 0) - Number(a.row.year || 0) ||
        b.row.sources.length - a.row.sources.length ||
        a.index - b.index
    )
  const relevant = scored.filter(s => s.score >= RELEVANT_SCORE && !s.noise)
  const rest = scored.filter(s => s.score < RELEVANT_SCORE || s.noise)
  // 折叠区里弱相关在前，非正片垫底
  const noise = rest.filter(s => s.noise)
  const weak = rest.filter(s => !s.noise)
  const more = [...weak, ...noise].map(s => s.row)
  const main = relevant.map(s => s.row)
  const merged = rows.length - kept.length
  if (!main.length || kept.length <= FOLD_THRESHOLD)
    return { main: [...main, ...more], more: [], merged }
  return { main, more, merged }
}
