/**
 * 扫描时的文件名解析：用 P1 解析器解析相对媒体库根目录的路径，得到写库的列与分组结果。
 *
 * 番号库：再从文件名（退到文件夹名）解析番号，认出来时以番号为片名，同一番号的分段 / 字幕版
 * 归到同一个条目；认不出的文件保持普通解析结果（识别时记为未匹配）。
 */
import { type FileGrouping, groupFile } from '../catalog/grouping'
import type { LibraryKind, LibrarySource } from '../../../shared/library/ipc'
import {
  type ParsedMedia,
  parseMediaPath,
} from '../../../shared/library/parser'
import { parseJavCode } from '../providers/jav/number'
import type { ParsedColumns } from './scan-store'

/**
 * 解析器版本。解析或分组规则有实质改动时 +1，引擎启动时会排一个解析任务重解析旧版本的文件。
 * 2：剧集按作品文件夹分组，不再按根下第一层（分类文件夹下的多部剧曾被并成一部）。
 */
export const PARSER_VERSION = 2

/** 一个文件的解析产物。 */
export interface FileParse {
  columns: ParsedColumns
  grouping: FileGrouping
}

/** 不需要解析的文件（nfo / 图片）。 */
const NOT_PARSED: FileParse = {
  columns: { parsed: null, parserVersion: PARSER_VERSION, state: 'parsed' },
  grouping: { ancestors: [], leaves: [] },
}

/** 媒体库上下文。 */
export interface ParseContext {
  libraryId: number
  kind: LibraryKind
  /** 媒体库根目录的路径键。 */
  rootKey: string
  /** 元数据来源，缺省 tmdb。 */
  source?: LibrarySource
}

/** 番号库的文件：认出番号时改用番号作片名（附加内容不动）。 */
function withJavCode(parsed: ParsedMedia, relativePath: string): ParsedMedia {
  if (parsed.type === 'extra') return parsed
  const segments = relativePath.split('/')
  const jav = parseJavCode(segments.at(-1)!, segments.slice(0, -1))
  if (!jav) return parsed
  return {
    type: 'movie',
    title: jav.code,
    code: jav.code,
    ...(jav.part !== undefined ? { part: jav.part } : {}),
  }
}

/**
 * 解析一个文件。只解析视频；解析器抛错时记为 error 状态，不中断扫描。
 * 传给解析器的是相对根目录的原始路径，避免根目录名（如“Movies”）被当成片名文件夹。
 */
export function parseLibraryFile(
  ctx: ParseContext,
  file: { key: string; displayPath: string; kind: string }
): FileParse {
  if (file.kind !== 'video') return NOT_PARSED
  const relativeKey = file.key.slice(ctx.rootKey.length + 1)
  const segments = file.displayPath.split(/[\\/]+/)
  const depth = relativeKey.split('/').length
  const relativePath = segments.slice(-depth).join('/')
  let parsed: ParsedMedia
  try {
    parsed = parseMediaPath(relativePath)
    if (ctx.source === 'jav') parsed = withJavCode(parsed, relativePath)
  } catch {
    return {
      columns: { parsed: null, parserVersion: PARSER_VERSION, state: 'error' },
      grouping: NOT_PARSED.grouping,
    }
  }
  return {
    columns: {
      parsed: JSON.stringify(parsed),
      parserVersion: PARSER_VERSION,
      state: 'parsed',
    },
    grouping: groupFile(
      { libraryId: ctx.libraryId, kind: ctx.kind, relativeKey },
      parsed
    ),
  }
}
