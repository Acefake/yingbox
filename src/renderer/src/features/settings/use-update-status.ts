import { type ComputedRef, type Ref, computed, ref } from 'vue'
import type {
  UpdateInfo,
  UpdateStatusEvent,
} from '../../../../shared/contract/update'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** useUpdateStatus 的返回值，传给 UpdateSettings 展示 */
export interface UpdateState {
  status: Ref<UpdateStatus>
  busy: Ref<boolean>
  progress: Ref<number>
  version: Ref<string>
  currentVersion: Ref<string>
  notes: Ref<string>
  /** 已点「更新并重启」，正在交给安装包 */
  installing: Ref<boolean>
  title: ComputedRef<string>
  message: ComputedRef<string>
  action: ComputedRef<string>
  runAction: () => Promise<void>
}

let shared: UpdateState | null = null

/**
 * 软件更新状态（GitHub Releases），全应用共享一份。
 *
 * 第一次调用时订阅主进程的 update.status 并恢复当前状态，全应用共用一份。
 */
export function useUpdateStatus(): UpdateState {
  shared ??= createUpdateState()
  return shared
}

function createUpdateState(): UpdateState {
  const status = ref<UpdateStatus>('idle')
  const busy = ref(false)
  const progress = ref(0)
  const error = ref('')
  const version = ref('')
  const currentVersion = ref('')
  const notes = ref('')
  const installing = ref(false)
  let statusEvents = 0

  const setInfo = (info: UpdateInfo): void => {
    if (info.version) version.value = info.version
    if (info.releaseNotes != null)
      notes.value = formatReleaseNotes(info.releaseNotes)
  }

  const title = computed(() => {
    if (status.value === 'checking') return '正在检查更新'
    if (status.value === 'available')
      return `发现新版本 ${version.value || ''}`.trim()
    if (status.value === 'not-available') return '当前已是最新版本'
    if (status.value === 'downloading') return '正在下载更新'
    if (status.value === 'downloaded') return '更新已下载'
    if (status.value === 'error') return '更新检查失败'
    return '检查软件更新'
  })

  const message = computed(() => {
    if (status.value === 'checking') return '正在连接 GitHub Releases...'
    if (status.value === 'available')
      return '可以下载新版本，下载完成后可重启安装'
    if (status.value === 'not-available') return '你的影盒版本已经是最新'
    if (status.value === 'downloading')
      return `下载进度 ${progress.value.toFixed(1)}%`
    if (status.value === 'downloaded')
      return '点击重启安装，应用会自动关闭并完成更新'
    if (status.value === 'error') return error.value || '请稍后重试'
    return '从 GitHub Release 检查是否有新版本'
  })

  /** 当前可执行的操作文案；空字符串表示无操作（检查 / 下载进行中） */
  const action = computed(() => {
    if (status.value === 'available') return '下载更新'
    if (status.value === 'downloaded') return '更新并重启'
    if (status.value === 'checking' || status.value === 'downloading') return ''
    return '检查更新'
  })

  const handleStatus = (payload: UpdateStatusEvent): void => {
    status.value = payload.status
    busy.value =
      payload.status === 'checking' || payload.status === 'downloading'
    if ('info' in payload) {
      setInfo(payload.info)
      if (payload.status === 'available' && payload.info.releaseNotes == null)
        notes.value = ''
    }
    if ('progress' in payload && payload.progress.percent != null)
      progress.value = payload.progress.percent
    if ('error' in payload) {
      error.value = payload.error
      installing.value = false
    }
  }

  const runAction = async (): Promise<void> => {
    busy.value = true
    error.value = ''
    try {
      if (status.value === 'available') {
        status.value = 'downloading'
        const result = await window.api.update.download()
        if (!result.success) {
          status.value = 'error'
          error.value = result.error || '下载更新失败'
        }
        return
      }
      if (status.value === 'downloaded') {
        installing.value = true
        await window.api.update.install()
        return
      }
      status.value = 'checking'
      const result = await window.api.update.check()
      if (!result.success) {
        status.value = 'error'
        error.value = result.error || '检查更新失败'
      }
    } catch (cause) {
      status.value = 'error'
      installing.value = false
      error.value = cause instanceof Error ? cause.message : '更新操作失败'
    } finally {
      if (status.value !== 'checking' && status.value !== 'downloading') {
        busy.value = false
      }
    }
  }

  const api = window.api?.update
  if (api) {
    api.onStatus(payload => {
      statusEvents++
      handleStatus(payload)
    })
    void api
      .snapshot()
      .then(snapshot => {
        currentVersion.value = snapshot.currentVersion
        if (
          snapshot.info &&
          (!version.value || snapshot.info.version === version.value)
        ) {
          if (!version.value && snapshot.info.version)
            version.value = snapshot.info.version
          if (!notes.value && snapshot.info.releaseNotes != null)
            notes.value = formatReleaseNotes(snapshot.info.releaseNotes)
        }
        if (!statusEvents) {
          if (snapshot.status) handleStatus(snapshot.status)
        }
      })
      .catch(cause => console.warn('[Updater] 无法恢复更新状态', cause))
  }

  return {
    status,
    busy,
    progress,
    version,
    currentVersion,
    notes,
    installing,
    title,
    message,
    action,
    runAction,
  }
}

/** 发布说明只作为文本展示，避免执行发行说明里的 HTML。 */
export function formatReleaseNotes(notes: UpdateInfo['releaseNotes']): string {
  const text = Array.isArray(notes)
    ? notes.map(item => item.note ?? '').join('\n\n')
    : (notes ?? '')
  const document = new DOMParser().parseFromString(
    text.replace(/<\/(?:p|li|h[1-6])>|<br\s*\/?\s*>/gi, '\n'),
    'text/html'
  )
  return (document.body.textContent ?? '').trim()
}
