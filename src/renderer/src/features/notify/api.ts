import { serverDomain } from '@/services/server-domains'

/** 推送渠道接口；网页端由 NAS 保存密钥与发送通知。 */
export function notificationApi(): Window['api']['notifications'] | undefined {
  return typeof window === 'undefined'
    ? undefined
    : (window.api?.notifications ?? serverDomain('notifications'))
}
