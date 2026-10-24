/**
 * 前情提要 / 问剧情的提示词构造（纯函数）。主进程用前三个做分段 / 整集摘要，
 * 渲染层用 {@link recapMessages}、{@link qaMessages} 发流式请求。
 *
 * 不剧透是硬约束：送进来的素材已经按进度截断，提示词再要求模型只依据素材、不推测之后的剧情。
 */
import type { AiMessage } from '../ai/types'
import {
  QA_HISTORY_MESSAGES,
  QA_HISTORY_TOKENS,
  truncateToTokens,
} from './budget'
import type { RecapContext, RecapEpisodeRef } from './types'

/** 秒 → 「m:ss」或「h:mm:ss」 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const showName = (show: string): string => (show ? `《${show}》` : '这部剧')

const SUMMARY_RULES =
  '用简体中文写剧情摘要：按时间顺序交代主要人物做了什么、关系和冲突有什么变化、留下了什么悬念；' +
  '人名保持原文写法（外文名可用通行中文译名）；只依据给出的台词，不要编造，不要评价；不要加标题。'

/** 一集里某一段台词的摘要 */
export function chunkSummaryMessages(input: {
  show: string
  label: string
  part: number
  total: number
  text: string
}): AiMessage[] {
  return [
    { role: 'system', content: `${SUMMARY_RULES}控制在 200 字以内。` },
    {
      role: 'user',
      content: `${showName(input.show)} ${input.label}，第 ${input.part}/${input.total} 段台词：\n${input.text}`,
    },
  ]
}

/** 整集只有一段时直接摘要 */
export function episodeSummaryMessages(input: {
  show: string
  label: string
  text: string
}): AiMessage[] {
  return [
    { role: 'system', content: `${SUMMARY_RULES}控制在 300 字以内。` },
    {
      role: 'user',
      content: `${showName(input.show)} ${input.label} 的台词：\n${input.text}`,
    },
  ]
}

/** 把一集的分段摘要合成整集摘要 */
export function mergeSummaryMessages(input: {
  show: string
  label: string
  parts: readonly string[]
}): AiMessage[] {
  return [
    {
      role: 'system',
      content: `${SUMMARY_RULES}下面是同一集按顺序的分段摘要，合并成一段完整的整集摘要，控制在 300 字以内。`,
    },
    {
      role: 'user',
      content: `${showName(input.show)} ${input.label}：\n${input.parts
        .map((part, i) => `【第 ${i + 1} 段】${part}`)
        .join('\n')}`,
    },
  ]
}

/** 之前各集摘要拼成一段素材 */
function previousBlock(context: RecapContext): string {
  return context.previous
    .map(
      item =>
        `【${item.label}${item.source === 'overview' ? '（分集简介）' : ''}】${item.text}`
    )
    .join('\n')
}

/** 前情提要：150–250 字的中文要点 */
export function recapMessages(context: RecapContext): AiMessage[] {
  const target = context.episode ? context.episode.label : '本集'
  return [
    {
      role: 'system',
      content:
        '你在为观众写「前情提要」，帮他在开播前快速想起之前发生了什么。' +
        '用简体中文写 3–5 条要点，每条以「• 」开头、单独一行，总长 150–250 字；' +
        '最后一条写上一集结尾停在哪里。只依据给出的摘要，不要推测或透露之后的剧情，不要加标题和结语。',
    },
    {
      role: 'user',
      content: `${showName(context.show)}，马上要看 ${target}。之前几集：\n${previousBlock(context)}`,
    },
  ]
}

/** 一条历史问答 */
export interface QaTurn {
  role: 'user' | 'assistant'
  text: string
}

const QA_RULES =
  '回答他关于剧情的问题（人物是谁、之前发生过什么、为什么这样做等）。规则：' +
  '只根据下面给出的素材回答；素材只覆盖到当前进度，绝不能透露、暗示或推测之后的剧情；' +
  '素材里找不到答案就直接说「目前的剧情里还没交代」或「我不确定」，不要编造；' +
  '用简体中文，2–4 句话，提到之前的情节时尽量说明是第几集。'

/** 问剧情：只用当前进度之前的素材回答 */
export function qaMessages(input: {
  context: RecapContext
  question: string
  history?: readonly QaTurn[]
}): AiMessage[] {
  const { context } = input
  const current = context.current
  const clock = formatClock(current?.seconds ?? 0)
  const target = context.episode?.label ?? '本片'
  const blocks: string[] = []
  if (context.previous.length)
    blocks.push(`之前几集的摘要：\n${previousBlock(context)}`)
  if (current?.summaries.length)
    blocks.push(
      `${target} 开头到现在的分段摘要：\n${current.summaries
        .map((part, i) => `【第 ${i + 1} 段】${part}`)
        .join('\n')}`
    )
  if (current?.recent)
    blocks.push(`${target} 到 ${clock} 为止最近的台词：\n${current.recent}`)
  if (!blocks.length) blocks.push('（没有可用的剧情素材）')

  const history = (input.history ?? [])
    .filter(turn => turn.text.trim())
    .slice(-QA_HISTORY_MESSAGES)
    .map(
      (turn): AiMessage => ({
        role: turn.role,
        content: truncateToTokens(turn.text, QA_HISTORY_TOKENS),
      })
    )

  return [
    {
      role: 'system',
      content: [
        `你在陪观众看${showName(context.show)}，他正看到 ${target} 的 ${clock}。${QA_RULES}`,
        ...blocks,
      ].join('\n\n'),
    },
    ...history,
    { role: 'user', content: input.question.trim() },
  ]
}

/** 卡片 / 面板上「截至哪里」的说明 */
export function scopeText(
  episode: RecapEpisodeRef | null,
  seconds?: number
): string {
  const label = episode?.label ?? '本片'
  return seconds === undefined
    ? `${label} 之前`
    : `${label} · ${formatClock(seconds)} 之前`
}
