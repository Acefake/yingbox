/**
 * 媒体库界面操作的统一提示：成功时提示 done（没给就不提示），失败时提示错误文本。
 */

import { toast } from '@/components/ui'
import { errorText } from '../api/bridge'

/** 跑一个操作并提示结果；不会抛出。 */
export async function guarded(
  task: () => Promise<unknown>,
  done?: string
): Promise<void> {
  try {
    await task()
    if (done) toast.success(done)
  } catch (error) {
    toast.error(errorText(error))
  }
}
