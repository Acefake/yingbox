/**
 * 观看进度同步设置的文案规则（不依赖 Vue，界面在 ProgressSyncGroup.vue）。
 */
import type { ProgressSyncStatus } from '../../../../../shared/contract/progress-sync'

/** 「上次同步」的相对时间：刚刚 / n 分钟前 / n 小时前 / 月日 时:分。 */
function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时前`
  const d = new Date(at)
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

/** 同步状态一行字：同步中 / 失败原因 / 上次同步时间与拉推条数 / 还没同步过。 */
export function syncStatusText(
  status: ProgressSyncStatus,
  now: number
): string {
  if (status.syncing) return '同步中…'
  if (status.error) return `同步失败：${status.error}`
  if (status.lastSyncAt === null) return '还没同步过'
  const moved =
    status.pulled || status.pushed
      ? `，拉下 ${status.pulled} 条、推上 ${status.pushed} 条`
      : '，两边一致'
  return `上次同步 ${ago(status.lastSyncAt, now)}${moved}`
}
