/**
 * IPC 边界上按画面搜参数的解析。非法时抛 LibraryError（invalid-params）。
 */
import type {
  VisualFramesSettings,
  VisualRpcMap,
  VisualSearchRequest,
} from './contract-visual'
import { asRecord, invalid, optionalInt, positiveId } from './validate-base'

/** 描述最长字符数（模型最多看 50 个 token）。 */
const MAX_TEXT = 100
/** 默认 / 最多返回部数。 */
const DEFAULT_LIMIT = 60
const MAX_LIMIT = 300

function parseSearch(input: unknown): VisualSearchRequest {
  const r = asRecord(input, '参数')
  if (typeof r.text !== 'string') invalid('text 必须是字符串')
  const text = (r.text as string).trim()
  if (!text) invalid('text 不能为空')
  if (text.length > MAX_TEXT) invalid(`text 最长 ${MAX_TEXT} 字`)
  return {
    text,
    ...(r.libraryId === undefined
      ? {}
      : { libraryId: positiveId(r.libraryId, 'libraryId') }),
    limit: Math.min(
      optionalInt(r.limit, 'limit', 1) ?? DEFAULT_LIMIT,
      MAX_LIMIT
    ),
  }
}

/** 视频关键帧设置的开关项。 */
const FRAME_FLAGS = ['enabled', 'paused', 'includeCloud'] as const

function parseFrames(input: unknown): Partial<VisualFramesSettings> {
  const r = asRecord(input, '参数')
  const out: Partial<VisualFramesSettings> = {}
  for (const flag of FRAME_FLAGS) {
    if (r[flag] === undefined) continue
    if (typeof r[flag] !== 'boolean') invalid(`${flag} 必须是布尔值`)
    out[flag] = r[flag] as boolean
  }
  return out
}

/** 按画面搜方法的参数解析器（并入 PARAM_PARSERS）。 */
export const VISUAL_PARSERS: {
  [M in keyof VisualRpcMap]: (input: unknown) => VisualRpcMap[M]['params']
} = {
  'visual.status': () => undefined,
  'visual.index': () => undefined,
  'visual.search': parseSearch,
  'visual.setFrames': parseFrames,
}
