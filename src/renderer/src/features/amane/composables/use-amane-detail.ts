/**
 * 片库页的详情弹窗状态：影片详情 / 任务详情（含子任务）。
 * 按 generation 防串台：关闭或打开另一个详情后，之前的请求结果直接丢弃。
 */
import { type Ref, ref } from 'vue'
import {
  type AmaneDetail,
  type AmaneTask,
  type AmaneUserTag,
  type Page,
  amaneRequest,
} from '../api/amane'

/** useAmaneDetail 的返回值：影片详情与任务详情弹窗的数据和操作 */
export interface AmaneDetailState {
  detailLoading: Ref<boolean>
  detail: Ref<AmaneDetail | null>
  taskDetail: Ref<AmaneTask | null>
  taskChildren: Ref<AmaneTask[]>
  closeDetail: () => void
  openFilm: (id: number) => Promise<void>
  showTask: (id: number) => Promise<void>
  updateDetailTags: (id: number, tags: AmaneUserTag[]) => void
  dispose: () => void
}

export function useAmaneDetail(
  error: Ref<string>,
  isDisposed: () => boolean
): AmaneDetailState {
  const detailLoading = ref(false)
  const detail = ref<AmaneDetail | null>(null),
    taskDetail = ref<AmaneTask | null>(null),
    taskChildren = ref<AmaneTask[]>([])
  let detailGeneration = 0

  function closeDetail(): void {
    detailGeneration++
    detailLoading.value = false
    detail.value = null
    taskDetail.value = null
    taskChildren.value = []
  }

  async function openFilm(id: number): Promise<void> {
    const current = ++detailGeneration
    detailLoading.value = true
    taskDetail.value = null
    try {
      const result = await amaneRequest<AmaneDetail>(`/metadata/${id}`)
      if (!isDisposed() && current === detailGeneration) detail.value = result
    } catch (e) {
      if (current === detailGeneration) {
        detail.value = null
        error.value = (e as Error).message
      }
    } finally {
      if (current === detailGeneration) detailLoading.value = false
    }
  }

  async function showTask(id: number): Promise<void> {
    const current = ++detailGeneration
    detailLoading.value = false
    try {
      const task = await amaneRequest<AmaneTask>(`/tasks/${id}`)
      const children = task.child_count
        ? await amaneRequest<Page<AmaneTask>>(`/tasks/${id}/children?limit=100`)
        : { items: [] }
      if (current !== detailGeneration || isDisposed()) return
      detail.value = null
      taskDetail.value = task
      taskChildren.value = children.items
    } catch (e) {
      error.value = (e as Error).message
    }
  }

  /** 详情里改了用户标签：同步到当前详情 */
  function updateDetailTags(id: number, tags: AmaneUserTag[]): void {
    if (detail.value?.metadata.id === id) detail.value.user_tags = tags
  }

  /** 卸载：之后回来的请求一律丢弃 */
  function dispose(): void {
    detailGeneration++
  }

  return {
    detailLoading,
    detail,
    taskDetail,
    taskChildren,
    closeDetail,
    openFilm,
    showTask,
    updateDetailTags,
    dispose,
  }
}
