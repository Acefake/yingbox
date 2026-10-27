/**
 * 网盘页 Hero 状态行的数据：115 账号、Torznab 地址数、经影盒添加的离线任务。
 * 每项各读各的，哪项失败就留 null（状态行不显示它），不影响其它项；只认最后一次刷新的结果。
 */
import { type Ref, ref } from 'vue'

import type { Api } from '../../../../../shared/contract'
import type { OfflineList } from '../../../../../shared/contract/offline'
import type { Pan115Account } from '../../../../../shared/contract/pan115'

/** 依赖（页面里传 netdisk / offlineDownloads） */
export interface NetdiskStatusDeps {
  pan115: () => Pick<Api['pan115'], 'account' | 'torznab'>
  offline: () => Pick<Api['offline'], 'tasks'>
}

/** 状态数据与刷新 */
export interface NetdiskStatus {
  account: Ref<Pan115Account | null>
  torznabCount: Ref<number | null>
  offline: Ref<OfflineList | null>
  refresh(): Promise<void>
}

export function useNetdiskStatus(deps: NetdiskStatusDeps): NetdiskStatus {
  const account = ref<Pan115Account | null>(null)
  const torznabCount = ref<number | null>(null)
  const offline = ref<OfflineList | null>(null)
  let seq = 0

  /** 读一项；失败为 null */
  async function read<T>(load: () => Promise<T>): Promise<T | null> {
    try {
      return await load()
    } catch {
      return null
    }
  }

  async function refresh(): Promise<void> {
    const id = ++seq
    const [nextAccount, torznab, tasks] = await Promise.all([
      read(() => deps.pan115().account()),
      read(() => deps.pan115().torznab()),
      read(() => deps.offline().tasks()),
    ])
    if (id !== seq) return
    account.value = nextAccount
    torznabCount.value = torznab ? torznab.urls.length : null
    offline.value = tasks
  }

  return { account, torznabCount, offline, refresh }
}
