/**
 * 媒体库管理：某分区（电影 / 剧集 / 番号，见 library-section.ts）的媒体库列表、添加 / 移除文件夹、扫描、识别全部，
 * 以及后台任务进度：扫描进度给分区页面顶部的细进度条；识别进度跨分区（一次识别会覆盖所有库），
 * 只在侧栏「后台任务」里显示（useIdentifyActivity），不再挤在每个分区页面上。
 *
 * 模块级单例：海报墙、设置页、待确认队列看到的是同一份状态，事件只订阅一次。
 */
import { type ComputedRef, type Ref, computed, reactive, ref } from 'vue'

import type {
  IdentifyProgressEvent,
  LibraryAutomation,
  LibraryInfo,
} from '../../../../../shared/library/ipc'
import { errorText, libraryBridge } from '../api/bridge'
import { pickLibraryFolder } from '../settings/folder-picker'
import { onLibraryEvent } from './library-events'
import { type LibrarySection, SECTIONS, librariesIn } from './library-section'

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

/**
 * 识别 / 刷新元数据的全局进度，给侧栏「后台任务」入口和面板用；没有在跑时为 null。
 * 没有媒体库能力（网页端未接片库服务）时恒为 null。
 */
export function useIdentifyActivity(): ComputedRef<LibraryActivity | null> {
  if (libraryBridge()) startOnce()
  return computed(() =>
    identify.value ? identifyActivity(identify.value) : null
  )
}

/** useLibraries 的返回值。 */
export interface UseLibraries {
  available: boolean
  libraries: ComputedRef<LibraryInfo[]>
  loaded: Ref<boolean>
  error: Ref<string | null>
  activity: ComputedRef<LibraryActivity | null>
  /** 选文件夹并添加为本分区的库（番号页添加的就是番号库）。 */
  addFolder: () => Promise<LibraryInfo | null>
  removeLibrary: (libraryId: number) => Promise<void>
  /** 改一个库的自动化设置（只改给出的字段）。 */
  updateAutomation: (
    libraryId: number,
    patch: Partial<LibraryAutomation>
  ) => Promise<void>
  scanAll: (full?: boolean) => Promise<void>
  identifyAll: (force?: boolean) => Promise<void>
  refreshAll: () => Promise<void>
}

/** 按 id 找媒体库（任何分区）；列表还没加载或不存在时为 undefined。 */
export function findLibrary(libraryId: number): LibraryInfo | undefined {
  return all.value.find(lib => lib.id === libraryId)
}

/** 某分区媒体库的管理状态与操作。 */
export function useLibraries(section: LibrarySection): UseLibraries {
  const bridge = libraryBridge()
  startOnce()
  const { kind, source } = SECTIONS[section]
  const libraries = computed(() => librariesIn(all.value, section))

  const activity = computed<LibraryActivity | null>(() =>
    scanJobs.size > 0 ? { label: '正在扫描文件夹…' } : null
  )

  async function run(task: () => Promise<unknown>): Promise<void> {
    try {
      await task()
      lastError.value = null
    } catch (error) {
      lastError.value = errorText(error)
      throw error
    }
  }

  async function addFolder(): Promise<LibraryInfo | null> {
    if (!bridge) return null
    const root = await pickLibraryFolder()
    if (!root) return null
    let info: LibraryInfo | null = null
    await run(async () => {
      info = await bridge.addLibrary({ root, kind, source })
    })
    return info
  }

  async function updateAutomation(
    libraryId: number,
    patch: Partial<LibraryAutomation>
  ): Promise<void> {
    await run(async () => {
      const info = await bridge!.updateLibrary({ libraryId, automation: patch })
      // 不等 libraries-changed 事件，先把返回的结果放进列表，开关不回弹
      all.value = all.value.map(lib => (lib.id === info.id ? info : lib))
    })
  }

  return {
    available: Boolean(bridge),
    libraries,
    updateAutomation,
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
