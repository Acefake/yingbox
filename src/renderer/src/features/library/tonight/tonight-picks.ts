/**
 * 「今晚看什么」的推荐规则（纯函数）：给模型的提示与 JSON Schema、模型结果的校验、
 * 本地兜底（评分 + 类型 + 随机）与「换一批」的排除集。
 *
 * 模型只能从候选里挑：返回的 id 不在候选里、重复或没理由的一律丢掉，不够 3 个用本地规则补齐。
 */
import type { AiMessage } from '@/features/ai'
import {
  type CompactCandidate,
  TONIGHT_TIMES,
  type TonightCandidate,
  type TonightMood,
  type TonightTime,
  clip,
  compactCandidate,
  moodSpec,
} from './tonight-rules'

/** 每次推荐几部 */
export const PICK_COUNT = 3
/** 理由最多几个字 */
export const REASON_CHARS = 60
/** 补充的一句话最多几个字 */
export const NOTE_CHARS = 100

/** 用户这次的要求 */
export interface TonightAsk {
  mood: TonightMood | null
  time: TonightTime
  /** 可选的一句话 */
  note?: string
}

/** 一条推荐 */
export interface TonightPick {
  candidate: TonightCandidate
  /** 一句中文理由 */
  reason: string
  /** 来自模型还是本地规则 */
  source: 'ai' | 'local'
}

/** 要求模型输出的结构 */
export const TONIGHT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['id', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['picks'],
  additionalProperties: false,
}

/** 用户的要求写成一段话 */
export function describeAsk(ask: TonightAsk): string {
  const mood = moodSpec(ask.mood)
  const time = TONIGHT_TIMES.find(t => t.id === ask.time)
  const note = clip(ask.note ?? '', NOTE_CHARS)
  return [
    `心情：${mood ? mood.label : '没有特别要求'}`,
    `可用时长：${time?.label ?? '不限'}`,
    note ? `补充：${note}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** 发给 chatJson 的消息 */
export function buildTonightMessages(
  ask: TonightAsk,
  candidates: readonly CompactCandidate[]
): AiMessage[] {
  return [
    {
      role: 'system',
      content: [
        '你是影盒的观影推荐助手，帮用户从自己的媒体库里挑今晚看的片子。',
        `只能从给出的候选里选，正好 ${PICK_COUNT} 部，id 不重复，尽量类型不同。`,
        'minutes 是今晚要花的分钟数（剧集按一集算），watching 表示正在看。',
        '有些候选还没刮削，类型（genres）或简介（overview）为空：这时按片名和年份凭你对这部片的了解判断。',
        `每部写一句简体中文理由（不超过 40 字），说清为什么适合现在看，不要剧透。`,
        '只输出 JSON：{"picks":[{"id":候选id,"reason":"理由"}]}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `${describeAsk(ask)}\n候选（JSON）：\n${JSON.stringify(candidates)}`,
    },
  ]
}

/** chatJson 的 validate：外形对就行，逐条校验在 validatePicks */
export function isPicksShape(data: unknown): data is { picks: unknown[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { picks?: unknown }).picks)
  )
}

/** 模型结果 → 推荐：id 必须在候选里、不重复，理由非空（截到 60 字），最多 3 条 */
export function validatePicks(
  data: unknown,
  candidates: readonly TonightCandidate[]
): TonightPick[] {
  if (!isPicksShape(data)) return []
  const byId = new Map(candidates.map(c => [c.id, c]))
  const out: TonightPick[] = []
  for (const raw of data.picks) {
    if (out.length >= PICK_COUNT) break
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as { id?: unknown; reason?: unknown }
    const id = typeof entry.id === 'string' ? Number(entry.id) : entry.id
    if (typeof id !== 'number' || !Number.isInteger(id)) continue
    const candidate = byId.get(id)
    if (!candidate || out.some(p => p.candidate.id === id)) continue
    const reason =
      typeof entry.reason === 'string' ? clip(entry.reason, REASON_CHARS) : ''
    if (!reason) continue
    out.push({ candidate, reason, source: 'ai' })
  }
  return out
}

/** 本地兜底的理由：类型 · 评分 · 心情 / 在看 */
export function localReason(
  c: TonightCandidate,
  mood: TonightMood | null
): string {
  const parts: string[] = []
  if (c.genres.length) parts.push(c.genres.slice(0, 2).join(' / '))
  if (c.rating) parts.push(`评分 ${c.rating.toFixed(1)}`)
  const head = parts.join('，')
  const spec = moodSpec(mood)
  const tail = c.continueId
    ? c.kind === 'series'
      ? '正在追，接着看下一段'
      : '上次看了一半，正好看完'
    : spec
      ? `适合${spec.phrase}的时候`
      : '库里值得一看的一部'
  return head ? `${head}，${tail}。` : `${tail}。`
}

/** 类型是否对得上心情 */
export function matchesMood(
  c: TonightCandidate,
  mood: TonightMood | null
): boolean {
  const spec = moodSpec(mood)
  if (!spec) return false
  const genres = c.genres.map(g => g.toLowerCase())
  return spec.genres.some(key => genres.some(g => g.includes(key)))
}

/**
 * 本地推荐：评分（未知按 6）+ 心情类型加 2 分 + 下饭偏好剧集 + 0–2 随机，取前 count 个。
 *
 * @param random 0–1 随机数（测试可注入）
 */
export function localPicks(
  candidates: readonly TonightCandidate[],
  mood: TonightMood | null,
  count = PICK_COUNT,
  random: () => number = Math.random
): TonightPick[] {
  return candidates
    .map(c => ({
      c,
      score:
        (c.rating ?? 6) +
        (matchesMood(c, mood) ? 2 : 0) +
        (mood === 'meal' && c.kind === 'series' ? 1 : 0) +
        random() * 2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ c }) => ({
      candidate: c,
      reason: localReason(c, mood),
      source: 'local' as const,
    }))
}

/** 模型给的不够 3 个时，用本地规则从剩下的候选里补齐 */
export function completePicks(
  picks: readonly TonightPick[],
  candidates: readonly TonightCandidate[],
  mood: TonightMood | null,
  random: () => number = Math.random
): TonightPick[] {
  if (picks.length >= PICK_COUNT) return picks.slice(0, PICK_COUNT)
  const taken = new Set(picks.map(p => p.candidate.id))
  const rest = candidates.filter(c => !taken.has(c.id))
  return [
    ...picks,
    ...localPicks(rest, mood, PICK_COUNT - picks.length, random),
  ]
}

/**
 * 「换一批」用的排除集：已推荐过的；剩下不够一批时从头再来（返回 reset: true）。
 *
 * @param available 去掉排除集后还剩几条候选
 */
export function nextExclude(
  shown: ReadonlySet<number>,
  available: number
): { exclude: Set<number>; reset: boolean } {
  if (available >= PICK_COUNT || shown.size === 0)
    return { exclude: new Set(shown), reset: false }
  return { exclude: new Set(), reset: true }
}

/** 发给模型的候选 */
export const compactAll = (
  candidates: readonly TonightCandidate[]
): CompactCandidate[] => candidates.map(compactCandidate)
