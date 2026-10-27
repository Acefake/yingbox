/**
 * 网盘页 Hero 底部的状态行与搜索小结（纯函数）。只显示真拿到的数据：115 是否登录、配了哪些搜索来源、
 * 离线中的任务数；读不到的项不显示，不编数字。
 */
import type { OfflineList } from '../../../../../shared/contract/offline'
import type { Pan115Account } from '../../../../../shared/contract/pan115'

/** 状态行的一项；ok 时前面带一个绿点 */
export interface HeroStatusItem {
  text: string
  ok?: boolean
}

/** 状态行用到的数据；null 表示没读到 */
export interface HeroStatusInput {
  account: Pan115Account | null
  pansou: boolean
  torznabCount: number | null
  offline: OfflineList | null
}

/** 离线中（等待 + 下载中）的任务数 */
export function activeOfflineCount(list: OfflineList | null): number {
  if (!list) return 0
  return list.tasks.filter(
    task => task.status === 'waiting' || task.status === 'running'
  ).length
}

/** 状态行：「115 已登录 · 账号名」「PanSou · Torznab 3 个源」「离线中 2」 */
export function heroStatusItems(input: HeroStatusInput): HeroStatusItem[] {
  const items: HeroStatusItem[] = []
  if (input.account)
    items.push(
      input.account.loggedIn
        ? {
            text: input.account.userName
              ? `115 已登录 · ${input.account.userName}`
              : '115 已登录',
            ok: true,
          }
        : { text: '115 未登录' }
    )
  const sources = [
    input.pansou ? 'PanSou' : '',
    input.torznabCount ? `Torznab ${input.torznabCount} 个源` : '',
  ].filter(Boolean)
  if (sources.length) items.push({ text: sources.join(' · ') })
  const active = activeOfflineCount(input.offline)
  if (active) items.push({ text: `离线中 ${active}` })
  return items
}

/** 搜索后的小结数据 */
export interface HeroSummary {
  shares: number
  magnets: number
  /** 最佳版本的说明（画质 + 体积）；认不出时为空串 */
  best: string
}
