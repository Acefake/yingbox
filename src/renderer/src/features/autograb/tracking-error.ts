/** 追剧错误只显示业务原因，网盘追剧不要求媒体库。 */
import { toast } from '@/components/ui/toast'

/** 去掉 IPC 包装后显示实际失败原因。 */
export async function showTrackingError(error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .replace(/^\[library:[a-z-]+\]\s*/, '')
  void toast.error(message)
}
