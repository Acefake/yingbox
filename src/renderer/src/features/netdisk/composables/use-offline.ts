/**
 * 115 离线下载：磁力行的「115 离线下载」与网盘页「离线任务」列表。
 * - 添加：存到 deps.folder() 给的文件夹（不给时主进程用电影默认目录）；同一链接进行中不重发；成功后记为已添加；
 *   未登录 115 时提示并打开设置 · 网盘去扫码；
 * - 列表：打开时读一次（主进程有未完成任务时会先向 115 同步），之后跟着 changed 事件刷新；
 *   页面停留期间每分钟再读一次（读的是主进程缓存，向 115 同步至少隔 15 秒，由主进程控制）。
 */
import { type Ref, onBeforeUnmount, reactive, ref } from 'vue'

import type { Api } from '../../../../../shared/contract'
import type { MagnetItem } from '../../../../../shared/contract/pan115'
import type { OfflineList } from '../../../../../shared/contract/offline'
import type { TargetFolder } from '../../../../../shared/netdisk/target-folder'

import { errorText } from '../utils/netdisk-rules'
import type { Notifier } from './use-share-actions'

/** 依赖（组件里传 offlineDownloads / toast / openNetdiskSettings） */
export interface OfflineDeps {
  api: () => Api['offline']
  notify: Notifier
  /** 未登录时去设置 · 网盘 */
  openLogin(): void
  /** 保存到哪（页面共用的转存目标）；不传时由主进程用默认目录 */
  folder?: () => TargetFolder
}

const REFRESH_MS = 60_000

/** 磁力行上的添加动作 */
export interface OfflineAdd {
  add(item: MagnetItem): Promise<void>
  isAdding(link: string): boolean
  isAdded(link: string): boolean
}

/** 离线任务列表的状态与方法 */
export interface OfflineTasks {
  list: Ref<OfflineList | null>
  loading: Ref<boolean>
  error: Ref<string>
  refresh(): Promise<void>
  start(): void
  stop(): void
}

/** 磁力行的「115 离线下载」 */
export function useOfflineAdd(deps: OfflineDeps): OfflineAdd {
  const adding = reactive(new Set<string>())
  const added = reactive(new Set<string>())

  async function add(item: MagnetItem): Promise<void> {
    const { link } = item
    if (adding.has(link) || added.has(link)) return
    adding.add(link)
    try {
      const folder = deps.folder?.()
      const result = folder
        ? await deps.api().add([link], folder)
        : await deps.api().add([link])
      if (!result.ok) {
        deps.notify.error(result.error)
        if (result.setup === 'login') deps.openLogin()
        return
      }
      const first = result.items[0]
      if (first?.ok) {
        added.add(link)
        const where = result.folder ? `「${result.folder}」` : '根目录'
        deps.notify.success(
          first.existed
            ? '115 里已有这个离线任务'
            : `已加入 115 离线下载，完成后存到${where}并自动入库`
        )
      } else deps.notify.error(first?.error ?? '115 没有返回结果')
    } catch (e) {
      deps.notify.error(`离线下载失败：${errorText(e)}`)
    } finally {
      adding.delete(link)
    }
  }

  return {
    add,
    isAdding: (link: string) => adding.has(link),
    isAdded: (link: string) => added.has(link),
  }
}

/** 离线任务列表：读取、跟着 changed 事件与定时刷新 */
export function useOfflineTasks(deps: Pick<OfflineDeps, 'api'>): OfflineTasks {
  const list = ref<OfflineList | null>(null)
  const loading = ref(false)
  const error = ref('')
  let timer: ReturnType<typeof setInterval> | undefined
  let seq = 0

  async function refresh(): Promise<void> {
    const id = ++seq
    loading.value = true
    try {
      const next = await deps.api().tasks()
      if (id !== seq) return
      list.value = next
      error.value = ''
    } catch (e) {
      if (id === seq) error.value = errorText(e)
    } finally {
      if (id === seq) loading.value = false
    }
  }

  /** 开始跟进：读一次、订阅 changed、每分钟再读 */
  function start(): void {
    if (timer) return
    void refresh()
    deps.api().onChanged(() => void refresh())
    timer = setInterval(() => void refresh(), REFRESH_MS)
  }

  function stop(): void {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
    deps.api().offChanged()
  }

  onBeforeUnmount(stop)
  return { list, loading, error, refresh, start, stop }
}
