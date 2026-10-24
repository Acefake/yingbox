/**
 * 两集音频指纹的比对（纯规则，做法同 Jellyfin intro-skipper）：
 *
 * 1. 指纹是 32 位整数序列，每点约 0.124 秒（chromaprint：11025Hz、步长 1365 采样；
 *    退回方案 pcm-print 按同样的步长生成，两种指纹共用这里的规则）；
 * 2. 先用倒排索引找「两集里完全相同的点」得到候选错位（B 下标 − A 下标），
 *    找不到时再逐个错位全量扫描；
 * 3. 某个错位下，逐点比汉明距离，不超过阈值算「相似」；相似点之间的空隙不超过
 *    maxGapSeconds 就连成一段，段首段尾相似点稀疏的部分修掉，最长且不短于 minSeconds 的一段即两集的公共片段；
 * 4. 静音 / 单调段指纹几乎不变，会被误认成公共片段：段内不同取值占比低于 minDistinct 的丢掉。
 */

/** 每个指纹点覆盖的秒数 */
export const POINT_SECONDS = 1365 / 11025

/** 比对参数 */
export interface MatchOptions {
  /** 一个点算「相似」允许的最多不同位数（32 位里） */
  maxBitDiff: number
  /** 公共片段最短秒数 */
  minSeconds: number
  /** 相似点之间允许的最长空隙（秒） */
  maxGapSeconds: number
  /** 段内不同取值占比下限（过滤静音 / 单调段） */
  minDistinct: number
}

/** 默认参数（chromaprint；intro-skipper 同款阈值） */
export const DEFAULT_MATCH: MatchOptions = {
  maxBitDiff: 6,
  minSeconds: 15,
  maxGapSeconds: 3.5,
  minDistinct: 0.3,
}

/** 一段时间（秒，相对片段起点） */
export interface Span {
  start: number
  end: number
}

/** 两集的公共片段：分别在 A、B 里的位置 */
export interface PairMatch {
  a: Span
  b: Span
}

/** 32 位整数里 1 的个数 */
export function popcount32(value: number): number {
  let x = value >>> 0
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  x = (x + (x >>> 4)) & 0x0f0f0f0f
  return Math.imul(x, 0x01010101) >>> 24
}

/**
 * 候选错位：两集里取值完全相同的点给出的「B 下标 − A 下标」，按出现次数从多到少，最多 limit 个。
 * 同一取值在一集里出现太多次（静音之类）的不参与，免得候选被它淹没。
 */
export function candidateShifts(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  limit = 16
): number[] {
  const index = new Map<number, number[]>()
  for (let j = 0; j < b.length; j++) {
    const list = index.get(b[j])
    if (!list) index.set(b[j], [j])
    else if (list.length <= 8) list.push(j)
  }
  const votes = new Map<number, number>()
  for (let i = 0; i < a.length; i++) {
    const list = index.get(a[i])
    if (!list || list.length > 8) continue
    for (const j of list) votes.set(j - i, (votes.get(j - i) ?? 0) + 1)
  }
  return [...votes.entries()]
    .filter(([, count]) => count >= 2)
    .sort((x, y) => y[1] - x[1] || x[0] - y[0])
    .slice(0, limit)
    .map(([shift]) => shift)
}

/** 全部可能的错位（两段至少重叠 minPoints 个点） */
export function allShifts(
  aLength: number,
  bLength: number,
  minPoints: number
): number[] {
  const out: number[] = []
  for (let s = minPoints - aLength; s <= bLength - minPoints; s++) out.push(s)
  return out
}

/** 一段指纹里不同取值的占比 */
function distinctRatio(a: ArrayLike<number>, from: number, to: number): number {
  const seen = new Set<number>()
  for (let i = from; i <= to; i++) seen.add(a[i])
  return seen.size / (to - from + 1)
}

/** 修边时看段首 / 段尾多少秒内的相似点密度 */
const EDGE_SECONDS = 2

const toPoints = (seconds: number): number =>
  Math.max(1, Math.round(seconds / POINT_SECONDS))

/**
 * 固定错位下的最长公共片段；没有够长的返回 null。
 * @param shift B 下标 − A 下标
 */
export function matchAtShift(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  shift: number,
  options: MatchOptions = DEFAULT_MATCH
): PairMatch | null {
  const minPoints = toPoints(options.minSeconds)
  const maxGap = toPoints(options.maxGapSeconds)
  const edge = toPoints(EDGE_SECONDS)
  const from = Math.max(0, -shift)
  const to = Math.min(a.length, b.length - shift)
  const hit = (i: number): boolean =>
    popcount32(a[i] ^ b[i + shift]) <= options.maxBitDiff
  /** 从 i 朝 dir 方向 edge 个点里，相似点是否过半（不越过 limit） */
  const dense = (i: number, dir: 1 | -1, limit: number): boolean => {
    let hits = 0
    let seen = 0
    for (
      let k = i;
      seen < edge && (dir > 0 ? k <= limit : k >= limit);
      k += dir
    ) {
      seen++
      if (hit(k)) hits++
    }
    return hits * 2 >= edge
  }
  let best: [number, number] | null = null
  let runStart = -1
  let last = -1
  const close = (): void => {
    if (runStart < 0) return
    // 修边：段首段尾零星的巧合相似点（靠空隙容忍连进来的）去掉
    let s = runStart
    let e = last
    while (e - s >= minPoints && !dense(s, 1, e)) {
      s++
      while (s < e && !hit(s)) s++
    }
    while (e - s >= minPoints && !dense(e, -1, s)) {
      e--
      while (e > s && !hit(e)) e--
    }
    const length = e - s + 1
    if (
      length >= minPoints &&
      (!best || length > best[1] - best[0] + 1) &&
      distinctRatio(a, s, e) >= options.minDistinct
    )
      best = [s, e]
  }
  for (let i = from; i < to; i++) {
    if (popcount32(a[i] ^ b[i + shift]) > options.maxBitDiff) continue
    if (runStart >= 0 && i - last > maxGap) close()
    if (runStart < 0 || i - last > maxGap) runStart = i
    last = i
  }
  close()
  if (!best) return null
  const [first, end] = best as [number, number]
  return {
    a: { start: first * POINT_SECONDS, end: (end + 1) * POINT_SECONDS },
    b: {
      start: (first + shift) * POINT_SECONDS,
      end: (end + 1 + shift) * POINT_SECONDS,
    },
  }
}

/** 一组错位里最长的公共片段；都没有返回 null。 */
export function bestMatch(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  shifts: readonly number[],
  options: MatchOptions = DEFAULT_MATCH
): PairMatch | null {
  let best: PairMatch | null = null
  for (const shift of shifts) {
    const found = matchAtShift(a, b, shift, options)
    if (
      found &&
      (!best || found.a.end - found.a.start > best.a.end - best.a.start)
    )
      best = found
  }
  return best
}
