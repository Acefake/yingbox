/**
 * 统一搜索的 AI 增强：把一句自然语言解析成片库条件（再按条件召回，与本地结果融合）。
 * 云端只接收当前查询与固定字段说明；不发送片库、路径、观看记录或字幕。私密范围不调用。
 */
import { isSearchCommand } from '@/utils/search-command'
import {
  aiAvailable,
  aiConfigured,
  aiKeyConfigured,
  chatJson,
} from '@/features/ai'
import { getSetting } from '@/features/settings'
import {
  NL_FILTER_SCHEMA,
  type NlFilter,
  isEmptyFilter,
  nlSystemPrompt,
  sanitizeNlFilter,
} from '../nl-search/nl-filter'
import { NlCache } from '../nl-search/nl-rules'
import type { SearchScope } from './types'

const cache = new NlCache<NlFilter>()
export async function enhanceConditions(
  text: string,
  scope: SearchScope,
  signal: AbortSignal
): Promise<NlFilter> {
  if (isSearchCommand(text)) throw new Error('仅在本地处理的界面命令。')
  if (scope === 'jav') throw new Error('私密范围仅使用本地搜索。')
  const provider = getSetting('ai.provider')
  const model = getSetting('ai.model')
  const baseUrl = getSetting('ai.baseUrl')
  if (
    !aiConfigured({
      available: aiAvailable(),
      provider,
      model,
      baseUrl,
      keyConfigured: aiKeyConfigured(provider),
    })
  )
    throw new Error('还没有配置 AI，只用本地搜索。')
  const key = JSON.stringify([
    scope,
    provider,
    model,
    baseUrl,
    new Date().getFullYear(),
    text,
  ])
  const hit = cache.get(key)
  if (hit) return hit
  const response = await chatJson(
    {
      messages: [
        {
          role: 'system',
          content: nlSystemPrompt([], new Date().getFullYear()),
        },
        { role: 'user', content: text.slice(0, 500) },
      ],
      schema: NL_FILTER_SCHEMA,
      schemaName: 'library_filter',
      temperature: 0,
      maxTokens: 400,
    },
    { signal }
  )
  if (signal.aborted) throw new Error('请求已停止')
  const filter = sanitizeNlFilter(response.data)
  if (isEmptyFilter(filter))
    throw new Error('没有解析出明确条件，已保留本地匹配结果。')
  cache.set(key, filter)
  return filter
}

/** AI 是否已配置到能做增强（读设置） */
export function enhanceReady(): boolean {
  const provider = getSetting('ai.provider')
  return aiConfigured({
    available: aiAvailable(),
    provider,
    model: getSetting('ai.model'),
    baseUrl: getSetting('ai.baseUrl'),
    keyConfigured: aiKeyConfigured(provider),
  })
}
