/**
 * 字幕翻译：按批（默认 40 条，带前后各 2 条上下文）送大模型，结构化输出校验条数与编号一致；
 * 一批失败重试，仍失败就降级为逐条翻译，逐条也失败的保留原文。时间轴始终不变。
 *
 * 不依赖 Electron：模型调用由调用方注入（主进程用 aiService().chatJson / chat，测试用 mock）。
 */
import type { AiMessage } from '../../shared/ai/types'
import type {
  AiSubtitleCue,
  AiSubtitleMode,
} from '../../shared/ai-subtitles/types'

/** 每批条数 */
export const BATCH_SIZE = 40
/** 每批前后各带几条上下文 */
export const CONTEXT_LINES = 2

/** 一批：要翻译的下标与上下文下标（都是 cues 的下标） */
export interface TranslateBatch {
  ids: number[]
  before: number[]
  after: number[]
}

/** 把 count 条字幕切成批 */
export function makeBatches(
  count: number,
  size = BATCH_SIZE,
  context = CONTEXT_LINES
): TranslateBatch[] {
  const batches: TranslateBatch[] = []
  const step = Math.max(1, Math.floor(size))
  for (let from = 0; from < count; from += step) {
    const to = Math.min(count, from + step)
    const range = (a: number, b: number): number[] =>
      Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i)
    batches.push({
      ids: range(from, to),
      before: range(Math.max(0, from - context), from),
      after: range(to, Math.min(count, to + context)),
    })
  }
  return batches
}

/** 翻译的上下文信息 */
export interface TranslateContext {
  /** 片名 */
  title?: string
  /** 原文语言（ISO 639-1） */
  language?: string
}

const lineOf = (
  cues: readonly AiSubtitleCue[],
  i: number
): { id: number; text: string } => ({
  id: i + 1,
  text: cues[i].text,
})

/** 一批的对话消息（编号为全片 1 起的序号） */
export function batchMessages(
  cues: readonly AiSubtitleCue[],
  batch: TranslateBatch,
  context: TranslateContext = {}
): AiMessage[] {
  const hints = [
    context.title ? `片名：${context.title}。` : '',
    context.language ? `原文语言：${context.language}。` : '',
  ].join('')
  return [
    {
      role: 'system',
      content:
        `你是影视字幕翻译。把 lines 里的每一条字幕翻译成简体中文，口语自然、简洁，人名地名前后一致。` +
        `必须逐条对应：输出条数与 lines 相同，id 原样保留，不合并、不拆分、不遗漏。` +
        `before / after 只是上下文，不要翻译它们。` +
        `只输出 JSON：{"items":[{"id":编号,"text":"译文"}]}。${hints}`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        before: batch.before.map(i => lineOf(cues, i)),
        lines: batch.ids.map(i => lineOf(cues, i)),
        after: batch.after.map(i => lineOf(cues, i)),
      }),
    },
  ]
}

/** 结构化输出的 JSON Schema（支持 json_schema 的服务商按它约束） */
export const BATCH_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, text: { type: 'string' } },
        required: ['id', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
}

/** 取出 items（容忍模型直接输出数组） */
function itemsOf(data: unknown): unknown[] | null {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const items = (data as { items?: unknown }).items
    if (Array.isArray(items)) return items
  }
  return null
}

/**
 * 校验一批的翻译结果：条数相同、编号恰好是这一批的编号（各一次）、译文是非空字符串。
 * 通过时返回 下标 → 译文；不通过返回 null。
 */
export function readBatchResult(
  data: unknown,
  batch: TranslateBatch
): Map<number, string> | null {
  const items = itemsOf(data)
  if (!items || items.length !== batch.ids.length) return null
  const wanted = new Set(batch.ids.map(i => i + 1))
  const result = new Map<number, string>()
  for (const item of items) {
    if (!item || typeof item !== 'object') return null
    const { id, text } = item as { id?: unknown; text?: unknown }
    const num = typeof id === 'string' ? Number(id) : id
    if (typeof num !== 'number' || !wanted.has(num) || result.has(num - 1))
      return null
    if (typeof text !== 'string' || !text.trim()) return null
    result.set(num - 1, text.trim())
  }
  return result
}

/** 逐条降级时的消息 */
export function singleMessages(
  text: string,
  context: TranslateContext = {}
): AiMessage[] {
  return [
    {
      role: 'system',
      content: `把用户给的一条影视字幕翻译成简体中文，只输出译文本身，不加引号和解释。${
        context.title ? `片名：${context.title}。` : ''
      }`,
    },
    { role: 'user', content: text },
  ]
}

/** 按输出模式合成最终字幕：中文 / 中文在上原文在下 / 原文 */
export function composeCues(
  cues: readonly AiSubtitleCue[],
  translations: readonly string[],
  mode: AiSubtitleMode
): AiSubtitleCue[] {
  if (mode === 'original') return cues.map(cue => ({ ...cue }))
  return cues.map((cue, i) => {
    const zh = translations[i]?.trim() || cue.text
    const text =
      mode === 'bilingual' && zh !== cue.text ? `${zh}\n${cue.text}` : zh
    return { ...cue, text }
  })
}

/** 翻译用到的模型调用（调用方绑定好 private / signal） */
export interface TranslateDeps {
  /** 结构化输出；抛错表示这次失败 */
  json(messages: AiMessage[], schema: Record<string, unknown>): Promise<unknown>
  /** 普通对话（逐条降级用），返回文本 */
  text(messages: AiMessage[]): Promise<string>
}

/** 这些错误重试也没用，整个任务直接失败 */
const FATAL_CODES = new Set(['cancelled', 'not_configured', 'private_blocked'])

/** 错误是否应终止整个翻译（取消、没配置、私密拦截，或已取消） */
export function isFatalError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && FATAL_CODES.has(code)
}

/** 翻译选项 */
export interface TranslateOptions extends TranslateContext {
  deps: TranslateDeps
  batchSize?: number
  /** 一批的重试次数（不含第一次） */
  retries?: number
  signal?: AbortSignal
  /** 进度 0–100 */
  onProgress?: (percent: number) => void
  /** 降级 / 保留原文时的日志 */
  onWarn?: (message: string) => void
}

/** 翻译全部字幕，返回与 cues 等长的译文（失败的条目为原文） */
export async function translateCues(
  cues: readonly AiSubtitleCue[],
  options: TranslateOptions
): Promise<string[]> {
  const { deps, signal } = options
  const out = cues.map(cue => cue.text)
  const batches = makeBatches(cues.length, options.batchSize)
  const retries = options.retries ?? 1
  const context: TranslateContext = {
    title: options.title,
    language: options.language,
  }
  for (const [n, batch] of batches.entries()) {
    signal?.throwIfAborted()
    let done: Map<number, string> | null = null
    for (let attempt = 0; attempt <= retries && !done; attempt++) {
      try {
        const data = await deps.json(
          batchMessages(cues, batch, context),
          BATCH_SCHEMA
        )
        done = readBatchResult(data, batch)
      } catch (error) {
        if (isFatalError(error, signal)) throw error
      }
    }
    if (done) {
      for (const [i, text] of done) out[i] = text
    } else {
      options.onWarn?.(`第 ${n + 1} 批翻译结果不符，逐条翻译这一批`)
      for (const i of batch.ids) {
        signal?.throwIfAborted()
        try {
          const text = (await deps.text(singleMessages(cues[i].text, context)))
            .trim()
            .replace(/^["“]|["”]$/g, '')
          if (text) out[i] = text
        } catch (error) {
          if (isFatalError(error, signal)) throw error
          options.onWarn?.(`第 ${i + 1} 条翻译失败，保留原文`)
        }
      }
    }
    options.onProgress?.(Math.round(((n + 1) / batches.length) * 100))
  }
  return out
}
