/**
 * 多集投票（纯规则）：两两比对得到的公共片段，按集汇总成整季通用的片头区间 / 片尾长度。
 *
 * - 比哪几对：每集和后面两集比（相邻集最可能共用片头，又不至于 n² 次比对）；
 * - 片头：每对给两集各一个候选区间；起止都在 tolerance 秒内的算同一个，
 *   支持它的「不同集」数最多的那组胜出，取起止的中位数；
 * - 片尾：片段取的是每集最后几分钟，先换算成「离结尾还有多少秒」再同样投票，
 *   片尾长度 = 公共片段开始处到结尾的秒数（片尾曲后面的下集预告也算片尾，跳过即播下一集）；
 * - 支持的集数不到 max(2, 一半) 时认为没有统一的片头 / 片尾（例如每集冷开场长度不同）。
 */
import type { PairMatch, Span } from './match'

/** 一集的一个候选区间 */
export interface Candidate extends Span {
  /** 第几集（输入顺序下标） */
  episode: number
}

/** 投票参数 */
export interface VoteOptions {
  /** 起止相差多少秒内算同一个区间 */
  tolerance: number
}

export const DEFAULT_VOTE: VoteOptions = { tolerance: 5 }

/** 要比对的集对：每集和后面 reach 集各比一次 */
export function pairsFor(count: number, reach = 2): [number, number][] {
  const pairs: [number, number][] = []
  for (let i = 0; i < count; i++)
    for (let j = i + 1; j <= Math.min(count - 1, i + reach); j++)
      pairs.push([i, j])
  return pairs
}

/** 至少要多少集支持才算数 */
export const minSupport = (episodes: number): number =>
  Math.max(2, Math.ceil(episodes / 2))

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * 投票选出整季通用的区间；支持不足返回 null。
 * @param episodes 参与比对的集数（决定最少支持数）
 */
export function voteSpan(
  candidates: readonly Candidate[],
  episodes: number,
  options: VoteOptions = DEFAULT_VOTE
): Span | null {
  let best: Candidate[] = []
  let bestSupport = 0
  for (const pivot of candidates) {
    const group = candidates.filter(
      c =>
        Math.abs(c.start - pivot.start) <= options.tolerance &&
        Math.abs(c.end - pivot.end) <= options.tolerance
    )
    const support = new Set(group.map(c => c.episode)).size
    const longer =
      support === bestSupport &&
      median(group.map(c => c.end - c.start)) >
        median(best.map(c => c.end - c.start))
    if (support > bestSupport || longer) {
      best = group
      bestSupport = support
    }
  }
  if (bestSupport < minSupport(episodes)) return null
  return {
    start: median(best.map(c => c.start)),
    end: median(best.map(c => c.end)),
  }
}

/** 一对片头比对结果 → 两集各一个候选 */
export function introCandidates(
  pair: [number, number],
  match: PairMatch
): Candidate[] {
  return [
    { episode: pair[0], ...match.a },
    { episode: pair[1], ...match.b },
  ]
}

/**
 * 一对片尾比对结果 → 两集各一个候选，换算成「离结尾的秒数」：
 * start = 片尾开始处离结尾多远（越大越早），end = 公共片段结束处离结尾多远。
 * 为了让 voteSpan 的 start ≤ end，返回时 start/end 对调成 { start: 结束处, end: 开始处 }。
 * @param clipSeconds 两集各自最后一段的实际时长
 */
export function outroCandidates(
  pair: [number, number],
  match: PairMatch,
  clipSeconds: [number, number]
): Candidate[] {
  const flip = (episode: number, span: Span, clip: number): Candidate => ({
    episode,
    start: Math.max(0, clip - span.end),
    end: Math.max(0, clip - span.start),
  })
  return [
    flip(pair[0], match.a, clipSeconds[0]),
    flip(pair[1], match.b, clipSeconds[1]),
  ]
}

/** 检测结论（秒）：片头区间、片尾长度；没检测到的项缺省 */
export interface Detected {
  intro?: Span
  outro?: number
}

/**
 * 汇总一季的结论。片头取整到秒；片尾长度 = 投票区间里「开始处离结尾的秒数」。
 * @param episodes 参与比对的集数
 */
export function summarize(
  intro: readonly Candidate[],
  outro: readonly Candidate[],
  episodes: number,
  options: VoteOptions = DEFAULT_VOTE
): Detected {
  const out: Detected = {}
  const introSpan = voteSpan(intro, episodes, options)
  if (introSpan)
    out.intro = {
      start: Math.max(0, Math.floor(introSpan.start)),
      end: Math.round(introSpan.end),
    }
  const outroSpan = voteSpan(outro, episodes, options)
  if (outroSpan) out.outro = Math.round(outroSpan.end)
  return out
}
