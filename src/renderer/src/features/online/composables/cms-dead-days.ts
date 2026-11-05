/**
 * CMS 源「连续不通」的起点记录与定期完整自检的计时。
 * 记录与健康缓存分开存：手动检测会清空健康记录，连续不通的天数不能跟着归零。
 */
import { useStorage } from '@vueuse/core'
import { DAY_MS, FULL_CHECK_MS, deadDays } from '../utils/cms-probe-rules'

/** api → 第一次连续失败的时间；成功一次就删掉 */
const since = useStorage<Record<string, number>>('online_cms_dead_since_v1', {})
let lastFull = Date.now()

/** 记一次检测结果（不含网络层的无结论） */
export function markCheck(api: string, ok: boolean): void {
  const current = since.value[api]
  if (ok) {
    if (current === undefined) return
    const { [api]: _gone, ...rest } = since.value
    since.value = rest
  } else if (current === undefined) {
    since.value = { ...since.value, [api]: Date.now() }
  }
}

/** 名称旁的补充说明：连续不通一天以上才写 */
export function deadNote(api: string): string {
  const days = deadDays(since.value[api], Date.now())
  return days >= 1 ? `已连续 ${days} 天不通` : ''
}

/** 距上次完整自检是否已到间隔；到了就记下这次 */
export function fullCheckDue(now = Date.now()): boolean {
  if (now - lastFull < FULL_CHECK_MS) return false
  lastFull = now
  return true
}

export { DAY_MS }
