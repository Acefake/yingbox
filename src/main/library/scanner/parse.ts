/**
 * 扫描时的文件名解析：用 P1 解析器解析相对媒体库根目录的路径，得到写库的列与分组结果。
 */
import { type FileGrouping, groupFile } from '../catalog/grouping'
import type { LibraryKind } from '../../../shared/library/ipc'
import {
  type ParsedMedia,
  parseMediaPath,
} from '../../../shared/library/parser'
import type { ParsedColumns } from './scan-store'

/**
 * 解析器版本。解析规则有实质改动时 +1，引擎启动时会排一个解析任务重解析旧版本的文件。
 */
export const PARSER_VERSION = 1

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
