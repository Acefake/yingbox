import { type ComputedRef, type Ref, computed, ref } from 'vue'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

interface UpdateStatusPayload {
  status?: UpdateStatus
  info?: { version?: string }
  progress?: { percent?: number }
  error?: string
}

/** useUpdateStatus 的返回值，传给 UpdateSettings 展示 */
export interface UpdateState {
  status: Ref<UpdateStatus>
  busy: Ref<boolean>
  progress: Ref<number>
  title: ComputedRef<string>
  message: ComputedRef<string>
  action: ComputedRef<string>
  runAction: () => Promise<void>
}

let shared: UpdateState | null = null

/**
 * 软件更新状态（GitHub Releases），全应用共享一份。
 *
 * 第一次调用时订阅主进程的 update.status 并常驻到应用退出：设置面板在创建时就调用一次，
 * 所以设置窗口关着时自动检查的结果也不会丢；更新分区再调用拿到的是同一份状态。
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
    if (status.value === 'downloaded') return '重启安装'
    if (status.value === 'checking' || status.value === 'downloading') return ''
    return '检查更新'
  })

  const handleStatus = (raw: unknown): void => {
    const payload = raw as UpdateStatusPayload
    status.value = payload.status || 'idle'
    busy.value =
      payload.status === 'checking' || payload.status === 'downloading'
    if (payload.info?.version) version.value = payload.info.version
    if (payload.progress?.percent != null)
      progress.value = payload.progress.percent
    if (payload.error) error.value = payload.error
  }

  const runAction = async (): Promise<void> => {
    busy.value = true
    error.value = ''
    try {
      if (status.value === 'available') {
        await window.api.update.download()
        return
      }
      if (status.value === 'downloaded') {
        await window.api.update.install()
        return
      }
      status.value = 'checking'
      const result = await window.api.update.check()
      if (!result.success) {
        status.value = 'error'
        error.value = result.error || '检查更新失败'
      }
    } finally {
      if (status.value !== 'checking' && status.value !== 'downloading') {
        busy.value = false
      }
    }
  }

  window.api?.update?.onStatus?.(handleStatus)

  return { status, busy, progress, title, message, action, runAction }
}
