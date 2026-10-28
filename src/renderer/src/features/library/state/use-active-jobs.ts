/** 后台任务面板的媒体库任务快照。 */
import { type Ref, onScopeDispose, ref, watch } from 'vue'
import type {
  ActiveLibraryJob,
  LibraryInfo,
} from '../../../../../shared/library/ipc'
import { errorText, libraryBridge } from '../api/bridge'
import { subscribeLibraryEvents } from './library-events'

/** 面板打开时定期读取队列，事件到来时及时刷新。 */
export function useActiveJobs(visible: Ref<boolean>): {
  jobs: Ref<ActiveLibraryJob[]>
  libraries: Ref<LibraryInfo[]>
  error: Ref<string | null>
  progress: Ref<Record<number, string>>
  cancelling: Ref<number[]>
  cancel: (jobId: number) => Promise<void>
} {
  const jobs = ref<ActiveLibraryJob[]>([])
  const libraries = ref<LibraryInfo[]>([])
  const error = ref<string | null>(null)
  const progress = ref<Record<number, string>>({})
  const cancelling = ref<number[]>([])
  let timer: ReturnType<typeof setInterval> | undefined
  let loading = false

  async function refresh(): Promise<void> {
    const bridge = libraryBridge()
    if (!bridge || loading) return
    if (typeof bridge.listActiveJobs !== 'function') {
      error.value = '请重启影盒以查看媒体库任务'
      return
    }
    loading = true
    try {
      const [next, libs] = await Promise.all([
        bridge.listActiveJobs(),
        bridge.listLibraries(),
      ])
      jobs.value = next
      cancelling.value = cancelling.value.filter(id =>
        next.some(job => job.jobId === id)
      )
      libraries.value = libs
      error.value = null
    } catch (e) {
      error.value = errorText(e)
    } finally {
      loading = false
    }
  }

  const off = subscribeLibraryEvents(event => {
    if (!visible.value) return
    if (event.type === 'writer-progress' && !event.finished) {
      progress.value[event.jobId] = `${event.done} / ${event.total}`
    } else if (event.type === 'identify-progress' && !event.finished) {
      progress.value[event.jobId] = `${event.done} / ${event.total}`
    } else if (event.type === 'job') {
      if (event.state !== 'running' && event.state !== 'queued') {
        delete progress.value[event.jobId]
      } else if (event.progress !== undefined && event.progress > 0) {
        progress.value[event.jobId] = `${Math.round(event.progress * 100)}%`
      }
    }
  })

  async function cancel(jobId: number): Promise<void> {
    const bridge = libraryBridge()
    if (!bridge || cancelling.value.includes(jobId)) return
    if (typeof bridge.cancelJob !== 'function') {
      error.value = '请重启影盒以取消媒体库任务'
      return
    }
    cancelling.value.push(jobId)
    try {
      if (!(await bridge.cancelJob(jobId))) {
        cancelling.value = cancelling.value.filter(id => id !== jobId)
      }
      await refresh()
    } catch (e) {
      cancelling.value = cancelling.value.filter(id => id !== jobId)
      error.value = errorText(e)
    }
  }

  watch(
    visible,
    open => {
      clearInterval(timer)
      if (open) {
        void refresh()
        timer = setInterval(() => void refresh(), 3000)
      }
    },
    { immediate: true }
  )
  onScopeDispose(() => {
    clearInterval(timer)
    off()
  })
  return { jobs, libraries, error, progress, cancelling, cancel }
}
