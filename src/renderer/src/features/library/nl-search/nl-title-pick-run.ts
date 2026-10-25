/**
 * 「按片名判断」的调用侧（use-nl-search 用）：在海报墙基础查询上组出三条查询、经 IPC 查条目、调模型。
 *
 * 结果按「分区 + 问题 + 查询范围」缓存：范围（媒体库、匹配筛选等，见 titlePickScope）进了缓存键，
 * 切换媒体库 / 改筛选后不会复用旧的 id 集合。规则在 nl-title-pick.ts。
 */
import type { LibraryQuery } from '../../../../../shared/library/ipc'
import { chatJson } from '@/features/ai'

import { libraryBridge } from '../api/bridge'
import type { NlFilter } from './nl-filter'
import { NlCache, type NlQueryContext, applyNlFilter } from './nl-rules'
import {
  TITLE_PICK_SCHEMA,
  type TitlePick,
  looseFilter,
  resolveTitlePick,
  titlePickScope,
} from './nl-title-pick'

/** 全应用共用一份缓存（null 表示不需要兜底）。 */
const pickCache = new NlCache<TitlePick | null>()

/** 一次按片名判断的输入。 */
export interface TitlePickRequest {
  /** 问题的缓存键（cacheKey(section, question)），会再拼上查询范围 */
  key: string
  question: string
  /** 模型解析出的条件 */
  parsed: NlFilter
  /** 海报墙的基础查询（纯对象） */
  base: LibraryQuery
  /** 查询上下文（不带 titlePick） */
  ctx: NlQueryContext
  /** 模型请求的隐私选项（私密分区 / 只用本地模型） */
  privacy: { private: boolean; localOnly?: true }
  signal: AbortSignal
}

/**
 * 条件里有类型时按需按片名判断；不需要（或没有查询接口）返回 null。
 * 查询 / 模型出错照常抛出，由调用方提示并保留类型筛选。
 */
export async function runTitlePick(
  req: TitlePickRequest
): Promise<TitlePick | null> {
  if (!req.parsed.genres?.length) return null
  const section = applyNlFilter(req.base, {}, req.ctx)
  const key = `${req.key}\n${titlePickScope(section)}`
  const hit = pickCache.get(key)
  if (hit !== undefined) return hit
  const api = libraryBridge()
  if (!api?.query) return null
  const pick = await resolveTitlePick(
    req.question,
    req.parsed,
    {
      strict: applyNlFilter(section, req.parsed, req.ctx),
      section,
      loose: applyNlFilter(section, looseFilter(req.parsed), req.ctx),
    },
    {
      // 经 JSON 转成纯对象再过 IPC（不把可能带响应式代理的对象直接传过去）
      query: query => api.query(JSON.parse(JSON.stringify(query))),
      chat: async messages =>
        (
          await chatJson(
            {
              messages,
              schema: TITLE_PICK_SCHEMA,
              schemaName: 'library_title_pick',
              temperature: 0,
              maxTokens: 1200,
              ...req.privacy,
            },
            { signal: req.signal }
          )
        ).data,
    }
  )
  if (!req.signal.aborted) pickCache.set(key, pick)
  return pick
}
