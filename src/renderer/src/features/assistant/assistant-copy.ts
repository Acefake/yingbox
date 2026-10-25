/**
 * 侧栏里随场景变化的文案：头部副标题、空闲时的问候说明、输入框默认占位。
 *
 * 私密模式下只写「私密 · 仅本地模型 · 无痕」，不写片名与页面名（私密内容的名字不出现在助手里）；
 * 普通模式的文案只来自当前页面名与在播片名，不含任何私密分区的字样。
 */
import { clockText } from './skills/skill-prompt'
import type { AssistantContext } from './skills/skill-types'

/**
 * 头部副标题：私密 → 仅本地模型；在播 → 片名 · 时间点；有角落小窗在播 → 页面 · 播放中；否则页面 · 当前页面。
 * @param context 当前状态
 */
export function assistantSubtitle(context: AssistantContext): string {
  if (context.private) return '私密 · 仅本地模型 · 无痕'
  const now = context.nowPlaying
  if (now) return `正在播放 · ${now.title} · ${clockText(now.seconds)}`
  return `${context.route.title} · ${context.playing ? '播放中' : '当前页面'}`
}

/**
 * 空闲时问候下面的一行说明，只写当前真能做到的事。
 * @param context 当前状态
 */
export function assistantGreetingHint(context: AssistantContext): string {
  if (context.private) return '对话只发给本地模型，关掉就不留记录。'
  if (context.nowPlaying)
    return context.plotQa
      ? '可以问问正在看的剧情，或者让我控制播放。'
      : '可以让我调倍速、开关弹幕或定时停止播放。'
  return '可以让我在媒体库里找片，或者接着上次看的。'
}

/**
 * 输入框的默认占位（生效技能没给占位时用）。
 * @param context 当前状态
 */
export function assistantPlaceholder(context: AssistantContext): string {
  if (!context.private && context.nowPlaying && context.plotQa)
    return '问问正在看的内容…'
  return '问影盒…'
}
