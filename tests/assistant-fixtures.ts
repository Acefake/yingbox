/**
 * AI 助手测试共用：普通模式下不许出现的敏感词、两种模式的上下文、模型输出的补全。
 */
import type { AssistantContext } from '../src/renderer/src/features/assistant/skills/skill-types'

/** 普通模式下助手的 DOM、提示词、建议、文案里都不许出现的字样 */
export const SENSITIVE =
  /成人|番号|无码|有码|去码|马赛克|女优|私密库|\bjav\b|\bav\b|lada/i

/** 普通模式、没在播放 */
export const idle: AssistantContext = {
  route: { path: '/movie', title: '电影' },
  playing: false,
  controllable: false,
  plotQa: false,
  private: false,
  nowPlaying: null,
}

/** 普通模式、内置播放器播放中 */
export const playing: AssistantContext = {
  ...idle,
  playing: true,
  controllable: true,
  plotQa: true,
  nowPlaying: { title: '沙丘：第二部', seconds: 5530 },
}

/** 私密模式 */
export const privateIdle: AssistantContext = {
  ...idle,
  route: { path: '/jav', title: '私密页面' },
  private: true,
}

/** 模型输出：未给的字段按 schema 填空串 / null */
export const raw = (
  fields: Record<string, unknown>
): Record<string, unknown> => ({
  action: 'answer',
  reply: '',
  text: '',
  target: '',
  command: '',
  value: null,
  on: null,
  ...fields,
})
