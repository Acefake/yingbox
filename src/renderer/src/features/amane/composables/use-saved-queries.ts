/**
 * 智能体的查询预设：列表、保留 / 删除、分页查看结果、导出当前页为 CSV。
 */
import { type Ref, ref } from 'vue'
import { amaneRequest } from '../api/amane'
import type { QueryResult, SavedQuery } from '../api/amane-agent'
import { QUERY_PAGE_SIZE, csvFilename, toCsv } from '../utils/agent'

export interface SavedQueryOptions {
  /** 与对话共用的串行执行器（共享 busy 与错误横幅） */
  act: (action: () => Promise<void>) => Promise<void>
  error: Ref<string>
  isDisposed: () => boolean
}

export function useSavedQueries(options: SavedQueryOptions) {
  const { act, error, isDisposed } = options
  const showQueries = ref(false),
    queries = ref<SavedQuery[]>([]),
    queryResult = ref<QueryResult | null>(null),
    queryId = ref(0),
    queryOffset = ref(0)

  /** 刷新列表；只有正在看预设时才把错误显示出来 */
  async function refreshQueries(): Promise<void> {
    try {
      const result = await amaneRequest<{ items: SavedQuery[] }>(
        '/saved-queries'
      )
      if (!isDisposed()) queries.value = result.items
    } catch (e) {
      if (showQueries.value && !isDisposed()) error.value = (e as Error).message
    }
  }

  /** 展开或收起查询预设，展开时刷新列表 */
  function toggleQueries(): void {
    showQueries.value = !showQueries.value
    void refreshQueries()
  }

  async function queryAction(
    id: number,
    action: 'persist' | 'delete'
  ): Promise<void> {
    if (action === 'delete' && !window.confirm('删除此查询预设？')) return
    await act(async () => {
      await amaneRequest('/saved-queries/batch', 'POST', { ids: [id], action })
      if (action === 'delete' && queryId.value === id) queryResult.value = null
      await refreshQueries()
    })
  }

  async function viewQuery(id: number, offset = 0): Promise<void> {
    await act(async () => {
      queryResult.value = await amaneRequest<QueryResult>(
        `/saved-queries/${id}/result?offset=${offset}&limit=${QUERY_PAGE_SIZE}`
      )
      queryId.value = id
      queryOffset.value = offset
    })
  }

  function exportQuery(): void {
    if (!queryResult.value) return
    const csv = toCsv(queryResult.value.columns, queryResult.value.rows)
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = csvFilename(queryId.value, queryOffset.value)
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return {
    showQueries,
    queries,
    queryResult,
    queryId,
    queryOffset,
    refreshQueries,
    toggleQueries,
    queryAction,
    viewQuery,
    exportQuery,
  }
}
