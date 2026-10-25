/**
 * IPC 边界上合并方法参数的解析。非法时抛 LibraryError（invalid-params）。
 */
import type { MergeRpcMap } from './contract-merge'
import { asRecord, positiveId } from './validate-base'

const itemIdParam = (input: unknown): { itemId: number } => ({
  itemId: positiveId(asRecord(input, '参数').itemId, 'itemId'),
})

/** 合并方法的参数解析器（并入 PARAM_PARSERS）。 */
export const MERGE_PARSERS: {
  [M in keyof MergeRpcMap]: (input: unknown) => MergeRpcMap[M]['params']
} = {
  'merge.split': itemIdParam,
  'merge.join': itemIdParam,
}
