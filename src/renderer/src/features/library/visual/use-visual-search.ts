/**
 * 按画面搜面板的状态：引擎状态（打开时取一次，下载 / 索引 / 抽帧中每秒轮询）、建立索引、
 * 视频画面开关、输入防抖搜索（300 ms，请求带序号防乱序）。
 *
 * 搜索词和结果放在模块级：点开一部片再回来，结果还在。
 */
import { useDebounceFn } from '@vueuse/core'
import { type Ref, onBeforeUnmount, ref, watch } from 'vue'
import type {
  VisualFramesSettings,
  VisualHit,
  VisualStatus,
} from '../../../../../shared/library/ipc'
import { errorText, libraryBridge } from '../api/bridge'
import { visualSearchSource } from './visual-source'

/** 轮询间隔。 */
const POLL_MS = 1000

const text = ref('')
const hits = ref<VisualHit[]>([])

export function useVisualSearch(options: {
  open: Ref<boolean>
  libraryId: () => number | undefined
}): {
  status: Ref<VisualStatus | null>
  text: Ref<string>
  hits: Ref<VisualHit[]>
  searching: Ref<boolean>
  error: Ref<string>
  startIndex: () => Promise<void>
  setFrames: (patch: Partial<VisualFramesSettings>) => Promise<void>
} {
  const status = ref<VisualStatus | null>(null)
  const searching = ref(false)
  const error = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  const api = ():
    | NonNullable<ReturnType<typeof libraryBridge>>['visual']
    | null => libraryBridge()?.visual ?? null

  async function refresh(): Promise<void> {
    clearTimeout(timer)
    const visual = api()
    if (!visual || !options.open.value) return
    try {
      const next = await visual.status()
      const before = status.value
      const finished =
        (before?.indexing && !next.indexing) ||
        (before?.frames.running && !next.frames.running)
      status.value = next
      if (next.indexing || next.frames.running)
        timer = setTimeout(() => void refresh(), POLL_MS)
      // 索引刚跑完：用新索引重搜一次
      if (finished && text.value.trim()) void search()
    } catch (e) {
      error.value = errorText(e)
    }
  }

  async function search(): Promise<void> {
    const visual = api()
    const query = text.value.trim()
    const id = ++seq
    if (!visual || !query || !options.open.value) {
      searching.value = false
      hits.value = []
      return
    }
    searching.value = true
    error.value = ''
    try {
      const libraryId = options.libraryId()
      const found = await visual.search({
        text: query,
        source: visualSearchSource.value,
        ...(libraryId ? { libraryId } : {}),
      })
      if (id === seq) hits.value = found
    } catch (e) {
      if (id === seq) error.value = errorText(e)
    } finally {
      if (id === seq) searching.value = false
    }
  }

  async function startIndex(): Promise<void> {
    const visual = api()
    if (!visual) return
    error.value = ''
    try {
      await visual.index()
    } catch (e) {
      error.value = errorText(e)
    }
    await refresh()
  }

  async function setFrames(
    patch: Partial<VisualFramesSettings>
  ): Promise<void> {
    const visual = api()
    if (!visual) return
    error.value = ''
    try {
      status.value = await visual.setFrames(patch)
    } catch (e) {
      error.value = errorText(e)
    }
    await refresh()
  }

  const searchLater = useDebounceFn(() => void search(), 300)
  watch(
    text,
    () => {
      seq++
      if (options.open.value) void searchLater()
    },
    { flush: 'sync' }
  )
  watch(
    visualSearchSource,
    () => {
      seq++
      hits.value = []
      if (options.open.value) void search()
    },
    { flush: 'sync' }
  )
  watch(
    () => options.open.value,
    open => {
      seq++
      searching.value = false
      if (open) {
        void refresh()
        if (text.value.trim()) void search()
      } else clearTimeout(timer)
    },
    { immediate: true }
  )
  watch(options.libraryId, () => void search())
  onBeforeUnmount(() => {
    seq++
    clearTimeout(timer)
  })

  return { status, text, hits, searching, error, startIndex, setFrames }
}
