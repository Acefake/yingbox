/**
 * 播放器里前情提要 / 问剧情的纯规则：什么时候浮出提示卡、错误怎么说。
 */
import type { AiErrorCode } from '../../../../../shared/ai/types'
import type { RecapProbe } from '../../../../../shared/recap/types'

/** 起播位置不超过这么多秒算「从头开始播」（与续播阈值一致） */
export const FROM_BEGINNING_SECONDS = 5
/** 提示卡没点开时多久自动收起 */
export const CARD_AUTO_HIDE_MS = 15_000

/** 开播时要不要浮出「前情提要」提示卡 */
export function shouldOfferRecap(input: {
  /** 设置 ai.recap.prompt */
  enabled: boolean
  probe: RecapProbe | null
  /** 起播位置（秒） */
  startAt: number
}): boolean {
  const { probe } = input
  if (!input.enabled || !probe?.episode) return false
  if (!probe.previous.length) return false
  return !(input.startAt > FROM_BEGINNING_SECONDS)
}

/** 去掉 Electron 给 IPC 错误加的外壳（「Error invoking remote method 'x': Error: 」） */
export function stripIpcPrefix(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:Error:\s*)+/, '')
    .replace(/^\[[a-z]+:[a-z_]+\]\s*/, '')
    .trim()
}

/** 失败时给用户看的一句话 */
export function recapErrorText(error: {
  code: AiErrorCode
  message: string
}): string {
  switch (error.code) {
    case 'not_configured':
      return '还没配置 AI：请在「设置 → AI」里选择服务商并填写 Key'
    case 'private_blocked':
      return '私密内容只用本地模型：请在「设置 → AI」换成本地服务商，或关闭对应开关'
    case 'timeout':
      return '模型响应超时，请稍后再试'
    case 'cancelled':
      return '已停止'
    default:
      return stripIpcPrefix(error.message) || '生成失败，请稍后再试'
  }
}
