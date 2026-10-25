/**
 * 助手的对话上下文：最近几轮问答，只在内存里，从不落盘（关掉应用就没了）。
 *
 * 每轮记下是不是在私密模式里问的；私密与普通之间切换、私密技能卸载时整段清空
 * （private-skills.ts 与 AssistantLauncher 调 {@link clearAssistantSession}），
 * 取上下文时如果发现模式对不上也会先清空，保证私密的对话不会带进普通模式的请求。
 */
import type { AiMessage } from '@/features/ai'

/** 最多带几轮 */
export const SESSION_TURNS = 4
/** 每句最多带多少字 */
const TURN_CHARS = 200

interface Turn {
  user: string
  reply: string
  private: boolean
}

let turns: Turn[] = []

const clip = (text: string): string =>
  [...text.trim()].slice(0, TURN_CHARS).join('')

/** 清空对话上下文 */
export function clearAssistantSession(): void {
  turns = []
}

/** 记一轮问答（回复为空时不记） */
export function recordAssistantTurn(
  user: string,
  reply: string,
  isPrivate: boolean
): void {
  if (!user.trim() || !reply.trim()) return
  if (turns.some(turn => turn.private !== isPrivate)) turns = []
  turns = [
    ...turns,
    { user: clip(user), reply: clip(reply), private: isPrivate },
  ].slice(-SESSION_TURNS)
}

/** 当前模式下可以带给模型的前几轮；模式对不上时先清空 */
export function assistantHistory(isPrivate: boolean): AiMessage[] {
  if (turns.some(turn => turn.private !== isPrivate)) turns = []
  return turns.flatMap(turn => [
    { role: 'user' as const, content: turn.user },
    { role: 'assistant' as const, content: turn.reply },
  ])
}

/** 当前记着几轮（测试用） */
export function assistantSessionSize(): number {
  return turns.length
}
