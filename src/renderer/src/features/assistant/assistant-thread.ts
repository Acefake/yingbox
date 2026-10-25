/**
 * 侧栏里的对话流：已结束的几轮问答（你说的话、回答、结果卡片、出错说明），只在侧栏打开期间保留在内存里。
 *
 * useAssistant 只管「当前这一轮」；开始新的一轮（打字提问、开始录音）前，把当前这一轮归档进对话流，
 * 侧栏按顺序显示「归档的几轮 + 当前这一轮」。最多保留 {@link THREAD_TURNS} 轮，更早的丢掉。
 * 带给模型的上下文另由 assistant-session.ts 管（不在这里）。
 */
import { type Ref, type ShallowRef, shallowRef } from 'vue'

import type { AssistantResult } from './skills/skill-types'

/** 对话流最多保留几轮 */
export const THREAD_TURNS = 12

/** 对话流里已结束的一轮 */
export interface ThreadTurn {
  id: number
  question: string
  answer: string
  result: AssistantResult | null
  notice: string
}

/**
 * 把一轮追加到对话流末尾（纯函数）：超出上限丢掉最早的；上限不大于 0 时一轮都不留。
 * 调用方先用 {@link hasQuestion} 判断要不要追加（没问话的不记，原数组不动）。
 * @param turns 已有的几轮
 * @param turn 要追加的一轮
 * @param limit 最多保留几轮
 */
export function appendTurn(
  turns: readonly ThreadTurn[],
  turn: ThreadTurn,
  limit = THREAD_TURNS
): ThreadTurn[] {
  if (limit <= 0) return []
  return [...turns, turn].slice(-limit)
}

/**
 * 这一轮有没有问话（没问话的不归档）。
 * @param question 你说的话
 */
export function hasQuestion(question: string): boolean {
  return question.trim().length > 0
}

/**
 * 归档时给结果拍一份快照：换成新数组 / 新对象，归档轮与当前轮不共用同一个对象，
 * 之后当前轮的结果怎么变都不会串到对话流里的旧卡片（卡片里的函数照原样保留）。
 * @param result 当前这一轮的结果
 */
export function snapshotResult(
  result: AssistantResult | null
): AssistantResult | null {
  if (!result) return null
  if (result.kind === 'cards')
    return { kind: 'cards', cards: [...result.cards] }
  return { ...result }
}

/** 当前这一轮的状态（来自 useAssistant） */
export interface CurrentTurn {
  transcript: Ref<string>
  answer: Ref<string>
  result: Ref<AssistantResult | null>
  notice: Ref<string>
}

/** useAssistantThread 的返回值 */
export interface AssistantThread {
  /** 已归档的几轮（按时间顺序） */
  turns: ShallowRef<ThreadTurn[]>
  /** 把当前这一轮归档（开始新一轮之前调用） */
  archive: () => void
}

/**
 * 侧栏打开期间的对话流。
 * @param current 当前这一轮的状态
 */
export function useAssistantThread(current: CurrentTurn): AssistantThread {
  const turns = shallowRef<ThreadTurn[]>([])
  let nextId = 1

  function archive(): void {
    const question = current.transcript.value
    // 没问话：数组引用不变，不触发对话流的重渲染与滚动，也不占用编号
    if (!hasQuestion(question)) return
    turns.value = appendTurn(turns.value, {
      id: nextId++,
      question,
      answer: current.answer.value,
      result: snapshotResult(current.result.value),
      notice: current.notice.value,
    })
  }

  return { turns, archive }
}
