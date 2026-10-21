/**
 * 媒体库管理：某类型（电影 / 剧集）的媒体库列表、添加 / 移除文件夹、扫描、识别全部，
 * 以及后台任务进度（扫描任务、识别进度）。
 *
 * 模块级单例：海报墙、设置页、待确认队列看到的是同一份状态，事件只订阅一次。
 */
import { type ComputedRef, type Ref, computed, reactive, ref } from 'vue'

import type {
  IdentifyProgressEvent,
  LibraryInfo,
  LibraryKind,
  LibrarySource,
} from '../../../../../shared/library/ipc'
import { errorText, libraryBridge } from '../api/bridge'
import { onLibraryEvent } from './library-events'

/** 后台活动：界面顶部的细进度条与状态文字。 */
export interface LibraryActivity {
  label: string
  /** 0–1；undefined 表示不确定进度（扫描）。 */
  progress?: number
}

/** 扫描类任务（扫描 → 解析 → 指纹）。 */
const SCAN_JOB_TYPES = new Set(['scan', 'parse', 'fingerprint'])

const all = ref<LibraryInfo[]>([])
const loaded = ref(false)
const lastError = ref<string | null>(null)
const scanJobs = reactive(new Set<number>())
const identify = ref<IdentifyProgressEvent | null>(null)
let started = false

function startOnce(): void {
  if (started) return
  started = true
  onLibraryEvent(event => {
    if (event.type === 'libraries-changed') {
      all.value = event.libraries
    } else if (event.type === 'job' && SCAN_JOB_TYPES.has(event.jobType)) {
      if (event.state === 'running' || event.state === 'queued') {
        scanJobs.add(event.jobId)
      } else {
        scanJobs.delete(event.jobId)
      }
    } else if (event.type === 'identify-progress') {
      identify.value = event.finished ? null : event
      if (event.finished && event.error) lastError.value = event.error
    }
  })
  void reload()
}

async function reload(): Promise<void> {
  const bridge = libraryBridge()
  if (!bridge) {
    loaded.value = true
    return
  }
  try {
    all.value = await bridge.listLibraries()
    lastError.value = null
  } catch (error) {
    lastError.value = errorText(error)
  } finally {
    loaded.value = true
  }
}

/** 识别进度 → 状态文字。 */
export function identifyActivity(
  event: IdentifyProgressEvent
): LibraryActivity {
  const verb = event.mode === 'refresh' ? '正在刷新元数据' : '正在识别'
  return {
    label: `${verb} ${event.done} / ${event.total}`,
    progress: event.total > 0 ? event.done / event.total : undefined,
  }
}

/** useLibraries 的返回值。 */
export interface UseLibraries {
  available: boolean
  libraries: ComputedRef<LibraryInfo[]>
  loaded: Ref<boolean>
  error: Ref<string | null>
  activity: ComputedRef<LibraryActivity | null>
  /** 选文件夹并添加；source 为 jav 时是番号文件夹（只用于电影库）。 */
  addFolder: (source?: LibrarySource) => Promise<LibraryInfo | null>
  removeLibrary: (libraryId: number) => Promise<void>
  scanAll: (full?: boolean) => Promise<void>
  identifyAll: (force?: boolean) => Promise<void>
  refreshAll: () => Promise<void>
}

/** 某类型媒体库的管理状态与操作。 */
export function useLibraries(kind: LibraryKind): UseLibraries {
  const bridge = libraryBridge()
  startOnce()
  const libraries = computed(() => all.value.filter(lib => lib.kind === kind))

  const activity = computed<LibraryActivity | null>(() => {
    if (identify.value) return identifyActivity(identify.value)
    if (scanJobs.size > 0) return { label: '正在扫描文件夹…' }
    return null
  })

  async function run(task: () => Promise<unknown>): Promise<void> {
    try {
      await task()
      lastError.value = null
    } catch (error) {
      lastError.value = errorText(error)
      throw error
    }
  }

  async function addFolder(
    source: LibrarySource = 'tmdb'
  ): Promise<LibraryInfo | null> {
    if (!bridge) return null
    const picked = await window.api.dialog.openDirectory()
    const root = picked.success && !picked.canceled ? picked.filePaths[0] : ''
    if (!root) return null
    let info: LibraryInfo | null = null
    await run(async () => {
      info = await bridge.addLibrary({ root, kind, source })
    })
    return info
  }

  return {
    available: Boolean(bridge),
    libraries,
    loaded,
    error: lastError,
    activity,
    addFolder,
    removeLibrary: libraryId => run(() => bridge!.removeLibrary(libraryId)),
    scanAll: full =>
      run(() =>
        Promise.all(
          libraries.value.map(lib => bridge!.scan({ libraryId: lib.id, full }))
        )
      ),
    identifyAll: force =>
      run(() =>
        Promise.all(
          libraries.value.map(lib =>
            bridge!.identify({ libraryId: lib.id, force })
          )
        )
      ),
    refreshAll: () =>
      run(() =>
        Promise.all(
          libraries.value.map(lib =>
            bridge!.refreshMetadata({ libraryId: lib.id })
          )
        )
      ),
  }
}
