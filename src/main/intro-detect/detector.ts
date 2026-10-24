/**
 * 检测一季：逐集取开头 / 结尾指纹 → 两两比对 → 投票得出整季通用的片头区间与片尾长度。
 *
 * - ffmpeg 一次只跑一个（低优先级）；比对在主进程里做，每对之间、全量扫描每批错位之间都让出事件循环，
 *   不卡界面；
 * - 随时可取消（AbortSignal）：取消后返回 null，不给半成品结论；
 * - 读不到音轨的集跳过，能用的不足两集时没有结论。
 */
import { setImmediate as yieldNow } from 'node:timers/promises'

import { type ClipPrint, type PrintMethod, clipPrint } from './ffmpeg'
import {
  DEFAULT_MATCH,
  type MatchOptions,
  POINT_SECONDS,
  type PairMatch,
  allShifts,
  bestMatch,
  candidateShifts,
} from './match'
import {
  type Candidate,
  type Detected,
  introCandidates,
  outroCandidates,
  pairsFor,
  summarize,
} from './vote'

/** 各指纹算法的比对参数：自算指纹比 chromaprint 粗，放宽一点相似阈值 */
export const MATCH_BY_METHOD: Record<PrintMethod, MatchOptions> = {
  chromaprint: DEFAULT_MATCH,
  pcm: { ...DEFAULT_MATCH, maxBitDiff: 8 },
}

/** 全量扫描时每批多少个错位（批与批之间让出事件循环） */
const SHIFT_BATCH = 300

/** 一季的检测结论 */
export interface SeasonOutcome extends Detected {
  /** 成功取到指纹的集数 */
  analyzed: number
}

/**
 * 两段指纹的最长公共片段：先试倒排索引给的候选错位，没有再分批全量扫描。
 * 被取消时返回 null。
 */
export async function compareClips(
  a: Uint32Array,
  b: Uint32Array,
  options: MatchOptions,
  signal: AbortSignal
): Promise<PairMatch | null> {
  const quick = bestMatch(a, b, candidateShifts(a, b), options)
  if (quick) return quick
  const minPoints = Math.round(options.minSeconds / POINT_SECONDS)
  const shifts = allShifts(a.length, b.length, minPoints)
  let best: PairMatch | null = null
  for (let i = 0; i < shifts.length; i += SHIFT_BATCH) {
    await yieldNow()
    if (signal.aborted) return null
    const found = bestMatch(a, b, shifts.slice(i, i + SHIFT_BATCH), options)
    if (
      found &&
      (!best || found.a.end - found.a.start > best.a.end - best.a.start)
    )
      best = found
  }
  return best
}

/**
 * 检测一季。
 * @param files 按集号排好的本地视频路径
 * @param onStep 进度：已完成步数 / 总步数（每集两段指纹 + 比对一步）
 * @returns 结论；被取消时 null
 */
export async function detectSeason(
  ffmpeg: string,
  method: PrintMethod,
  files: readonly string[],
  signal: AbortSignal,
  onStep: (done: number, total: number) => void
): Promise<SeasonOutcome | null> {
  const total = files.length * 2 + 1
  let done = 0
  const heads: ClipPrint[] = []
  const tails: ClipPrint[] = []
  for (const file of files) {
    const head = await clipPrint(ffmpeg, file, 'head', method, signal)
    onStep(++done, total)
    const tail = head
      ? await clipPrint(ffmpeg, file, 'tail', method, signal)
      : null
    onStep(++done, total)
    if (signal.aborted) return null
    if (head && tail) {
      heads.push(head)
      tails.push(tail)
    }
  }
  const analyzed = heads.length
  if (analyzed < 2) return { analyzed }

  const options = MATCH_BY_METHOD[method]
  const intro: Candidate[] = []
  const outro: Candidate[] = []
  for (const pair of pairsFor(analyzed)) {
    const [i, j] = pair
    const head = await compareClips(
      heads[i].points,
      heads[j].points,
      options,
      signal
    )
    if (head) intro.push(...introCandidates(pair, head))
    const tail = await compareClips(
      tails[i].points,
      tails[j].points,
      options,
      signal
    )
    if (tail)
      outro.push(
        ...outroCandidates(pair, tail, [tails[i].seconds, tails[j].seconds])
      )
    if (signal.aborted) return null
    await yieldNow()
  }
  onStep(total, total)
  return { analyzed, ...summarize(intro, outro, analyzed) }
}
