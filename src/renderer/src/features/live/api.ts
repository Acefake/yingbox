import { serverDomain } from '@/services/server-domains'

/** 直播读取与节目单接口：桌面走 IPC，网页走 NAS 的 HTTP 契约域。 */
export function liveApi(): Window['api']['iptv'] | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window.api?.iptv ?? serverDomain('iptv'))
}
