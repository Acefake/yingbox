/**
 * 助手里随场景变化的文案：上下文胶囊（页面 / 在播 / 私密）、输入框占位与后面的浅色示例。
 *
 * 私密模式下只写「私密 · 仅本地模型 · 无痕」，不写片名与页面名（私密内容的名字不出现在助手里）；
 * 普通模式的文案只来自当前页面名与在播片名，不含任何私密分区的字样。
 */
import { clockText } from './skills/skill-prompt'
import type { AssistantContext } from './skills/skill-types'

/**
 * 上下文胶囊：私密 → 仅本地模型；在播 → 片名 · 时间点；有角落小窗在播 → 页面 · 播放中；否则页面 · 当前页面。
 * @param context 当前状态
 */
export function assistantSubtitle(context: AssistantContext): string {
  if (context.private) return '私密 · 仅本地模型 · 无痕'
  const now = context.nowPlaying
  if (now) return `正在播放 · ${now.title} · ${clockText(now.seconds)}`
  return `${context.route.title} · ${context.playing ? '播放中' : '当前页面'}`
}

/**
 * 输入框占位后面那句浅色示例（「例如「…」」），只举当前真能做到的事；私密模式不举例（不写任何片名或分区字样）。
 * @param context 当前状态
 */
export function assistantExample(context: AssistantContext): string {
  if (context.private) return ''
  if (context.nowPlaying)
    return context.plotQa ? '例如「刚才发生了什么」' : '例如「1.5 倍速」'
  return '例如「找几部适合周末看的科幻片」'
}

/**
 * 输入框的默认占位（生效技能没给占位时用）。输入框同时是片库搜索框，所以写明两件事都能做。
 * @param context 当前状态
 * @param askable 能不能问 AI（网页版只有搜索）
 */
export function assistantPlaceholder(
  context: AssistantContext,
  askable = true
): string {
  if (!askable) return '搜索片名、人物…'
  if (!context.private && context.nowPlaying && context.plotQa)
    return '搜索片库，或问正在看的内容…'
  return '搜索片库，或问影盒…'
}
