/**
 * 网盘变更通知设置的纯规则：地址里的令牌打码、状态文字、桌面端才有。不依赖 Vue，便于单测。
 */
import type { LibraryNotifyStatus } from '../../../../../shared/contract/library-notify'

/** 地址展示用：令牌只留末 4 位。 */
export function maskNotifyUrl(url: string): string {
  return url.replace(/([?&]token=)[^&]*?([^&]{0,4})(?=&|$)/, '$1••••$2')
}

/** 通知地址行的描述。 */
export function notifyAddressText(status: LibraryNotifyStatus): string {
  if (status.error) return status.error
  if (!status.url) return '正在启动…'
  return maskNotifyUrl(status.url)
}
