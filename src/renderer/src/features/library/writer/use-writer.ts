/**
 * 写出与整理在界面侧的状态：设置读写、写出 NFO 与图片、整理的“预览 → 执行 → 撤销”流程，
 * 以及 writer-progress 进度。
 *
 * writer bridge 不存在（网页版 / 旧 preload）时 available 为 false，界面把入口置灰并提示。
 */
import {
  type ComputedRef,
  type Ref,
  computed,
  ref,
  shallowRef,
  toRaw,
} from 'vue'

import {
  DEFAULT_WRITER_SETTINGS,
  type OrganizeBatchInfo,
  type OrganizePlan,
  type WriterProgressEvent,
  type WriterSettings,
} from '../../../../../shared/library/ipc'
import { toast } from '@/components/ui'

import { errorText, writerBridge } from '../api/bridge'
import { subscribeLibraryEvents } from '../state/library-events'
import { writerFailureText } from './writer-errors'

/** 写出入口不可用时的提示。 */
export const WRITER_UNAVAILABLE = '写出 NFO 与整理仅在桌面版可用'

/** 写出进度 → 状态文字（后台任务进度条用）。 */
export function writerActivity(event: WriterProgressEvent): {
  label: string
  progress?: number
} {
  const verb =
    event.mode === 'write'
      ? '正在写出 NFO 与图片'
      : event.mode === 'organize'
        ? '正在整理文件'
        : '正在撤销整理'
  return {
    label: `${verb} ${event.done} / ${event.total}`,
    progress: event.total > 0 ? event.done / event.total : undefined,
  }
}

/** 整理流程的阶段。 */
export type OrganizeStage =
  | { stage: 'idle' }
  | { stage: 'previewing' }
  | { stage: 'preview'; plan: OrganizePlan }
  | { stage: 'applying'; plan: OrganizePlan }
  | { stage: 'applied'; batchId: number; moved: number }
  | { stage: 'undoing'; batchId: number }
  | { stage: 'undone' }
  | { stage: 'error'; message: string }

/** 计划里会执行（没有冲突）的项数。 */
export function runnableCount(plan: OrganizePlan): number {
  return plan.entries.filter(entry => !entry.conflict).length
}

const progress = shallowRef<WriterProgressEvent | null>(null)
let listening = false

function listenOnce(): void {
  if (listening) return
  listening = true
  // 单例订阅不绑组件作用域：第一个调用者卸载后，其他页面仍要收到事件
  subscribeLibraryEvents(event => {
    if (event.type === 'writer-progress') {
      progress.value = event.finished ? null : event
      // 写出 / 整理是后台任务，失败（只读挂载、没权限……）只有这里能告诉用户
      const failure = writerFailureText(event)
      if (failure) toast.error(failure)
    }
  })
}

/** useWriter 的返回值。 */
export interface UseWriter {
  available: boolean
  progress: Ref<WriterProgressEvent | null>
  write: (itemIds: number[]) => Promise<string | null>
  organize: Ref<OrganizeStage>
  previewOrganize: (itemIds: number[]) => Promise<void>
  applyOrganize: () => Promise<void>
  undoOrganize: (batchId: number) => Promise<void>
  resetOrganize: () => void
  listBatches: () => Promise<OrganizeBatchInfo[]>
}

/** 写出与整理操作。 */
export function useWriter(): UseWriter {
  const bridge = writerBridge()
  listenOnce()
  const organize = ref<OrganizeStage>({ stage: 'idle' })

  async function previewOrganize(itemIds: number[]): Promise<void> {
    if (!bridge) return
    organize.value = { stage: 'previewing' }
    try {
      organize.value = {
        stage: 'preview',
        plan: await bridge.previewOrganize([...itemIds]),
      }
    } catch (error) {
      organize.value = { stage: 'error', message: errorText(error) }
    }
  }

  async function applyOrganize(): Promise<void> {
    const current = organize.value
    if (!bridge || current.stage !== 'preview') return
    organize.value = { stage: 'applying', plan: current.plan }
    try {
      const { batchId } = await bridge.applyOrganize(current.plan.planId)
      organize.value = {
        stage: 'applied',
        batchId,
        moved: runnableCount(current.plan),
      }
    } catch (error) {
      organize.value = { stage: 'error', message: errorText(error) }
    }
  }

  async function undoOrganize(batchId: number): Promise<void> {
    if (!bridge) return
    organize.value = { stage: 'undoing', batchId }
    try {
      await bridge.undoOrganize(batchId)
      organize.value = { stage: 'undone' }
    } catch (error) {
      organize.value = { stage: 'error', message: errorText(error) }
    }
  }

  return {
    available: Boolean(bridge),
    progress,
    async write(itemIds) {
      if (!bridge) return WRITER_UNAVAILABLE
      try {
        await bridge.write(itemIds)
        return null
      } catch (error) {
        return errorText(error)
      }
    },
    organize,
    previewOrganize,
    applyOrganize,
    undoOrganize,
    resetOrganize: () => {
      organize.value = { stage: 'idle' }
    },
    listBatches: async () => (bridge ? bridge.listOrganizeBatches() : []),
  }
}

/** 写出设置（设置页用）：读取、修改后防抖保存。 */
export function useWriterSettings(): {
  available: boolean
  settings: Ref<WriterSettings>
  loaded: Ref<boolean>
  error: Ref<string | null>
  saving: ComputedRef<boolean>
  update: (mutate: (draft: WriterSettings) => void) => void
} {
  const bridge = writerBridge()
  const settings = ref<WriterSettings>(structuredClone(DEFAULT_WRITER_SETTINGS))
  const loaded = ref(!bridge)
  const error = ref<string | null>(null)
  const pending = ref(0)
  let timer: ReturnType<typeof setTimeout> | undefined

  if (bridge) {
    bridge
      .getSettings()
      .then(value => {
        settings.value = value
      })
      .catch(e => {
        error.value = errorText(e)
      })
      .finally(() => {
        loaded.value = true
      })
  }

  function save(): void {
    timer = undefined
    if (!bridge) return
    pending.value++
    bridge
      .setSettings(structuredClone(toRaw(settings.value)))
      .then(value => {
        // 保存期间用户又改了（新的定时器在等），以界面上的为准
        if (!timer) settings.value = value
        error.value = null
      })
      .catch(e => {
        error.value = errorText(e)
      })
      .finally(() => {
        pending.value--
      })
  }

  return {
    available: Boolean(bridge),
    settings,
    loaded,
    error,
    saving: computed(() => pending.value > 0),
    update(mutate) {
      if (!bridge) return
      mutate(settings.value)
      clearTimeout(timer)
      // 模板输入框逐字修改，停顿后再保存；开关类修改也走同一条路，400ms 内合并
      timer = setTimeout(save, 400)
    },
  }
}
