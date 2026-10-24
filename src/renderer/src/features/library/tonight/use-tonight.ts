/**
 * 「今晚看什么」面板的状态与动作：选心情 / 时长 / 一句话 → 本地筛候选 → 模型挑 3 部（chatJson）。
 *
 * - AI 未配置或不是桌面端：直接用本地规则（评分 + 类型 + 随机），并提示可以去配置 AI；
 * - 模型出错（网络 / 超时 / 输出不合格）：同样退回本地规则，提示原因；
 * - 「换一批」排除本次打开里已推荐过的，剩下不够一批时从头再来；
 * - 新请求会取消上一个还没回来的模型调用。
 */
import { type Ref, type ShallowRef, ref, shallowRef } from 'vue'

import { AiCallError, aiAvailable, chatJson } from '@/features/ai'

import { errorText } from '../api/bridge'
import {
  TONIGHT_SCHEMA,
  type TonightAsk,
  type TonightPick,
  buildTonightMessages,
  compactAll,
  completePicks,
  isPicksShape,
  localPicks,
  nextExclude,
  validatePicks,
} from './tonight-picks'
import {
  type TonightMood,
  type TonightTime,
  selectCandidates,
} from './tonight-rules'
import { loadTonightCandidates } from './tonight-source'

/** 面板顶部的提示：AI 未配置时带「去配置」 */
export interface TonightNotice {
  text: string
  configure?: boolean
}

/** useTonight 的返回值 */
export interface UseTonight {
  mood: Ref<TonightMood | null>
  time: Ref<TonightTime>
  note: Ref<string>
  picks: ShallowRef<TonightPick[]>
  busy: Ref<'fresh' | 'shuffle' | null>
  notice: Ref<TonightNotice | null>
  empty: Ref<boolean>
  toggleMood: (next: TonightMood) => void
  recommend: (fresh: boolean) => Promise<void>
  cancel: () => void
}

export function useTonight(): UseTonight {
  const mood = ref<TonightMood | null>(null)
  const time = ref<TonightTime>('two')
  const note = ref('')
  const picks = shallowRef<TonightPick[]>([])
  /** 正在推荐：fresh 是「帮我挑」，shuffle 是「换一批」 */
  const busy = ref<'fresh' | 'shuffle' | null>(null)
  const notice = ref<TonightNotice | null>(null)
  /** 选了条件但一部都放不下 */
  const empty = ref(false)

  let shown = new Set<number>()
  let controller: AbortController | null = null

  function toggleMood(next: TonightMood): void {
    mood.value = mood.value === next ? null : next
  }

  async function aiPicks(
    ask: TonightAsk,
    candidates: ReturnType<typeof selectCandidates>,
    signal: AbortSignal
  ): Promise<TonightPick[]> {
    const result = await chatJson(
      {
        messages: buildTonightMessages(ask, compactAll(candidates)),
        schema: TONIGHT_SCHEMA,
        schemaName: 'tonight_picks',
        temperature: 0.8,
        maxTokens: 600,
      },
      { signal, validate: isPicksShape }
    )
    return completePicks(
      validatePicks(result.data, candidates),
      candidates,
      ask.mood
    )
  }

  /** 推荐一批；fresh = 重新开始（清空已推荐） */
  async function recommend(fresh: boolean): Promise<void> {
    controller?.abort()
    const current = new AbortController()
    controller = current
    busy.value = fresh ? 'fresh' : 'shuffle'
    if (fresh) shown = new Set()
    try {
      const all = await loadTonightCandidates(fresh)
      const ask: TonightAsk = {
        mood: mood.value,
        time: time.value,
        note: note.value,
      }
      let candidates = selectCandidates(all, { time: ask.time, exclude: shown })
      const next = nextExclude(shown, candidates.length)
      if (next.reset) {
        shown = next.exclude
        candidates = selectCandidates(all, { time: ask.time })
      }
      empty.value = candidates.length === 0
      if (!candidates.length) {
        picks.value = []
        notice.value = null
        return
      }

      let result: TonightPick[]
      if (!aiAvailable()) {
        result = localPicks(candidates, ask.mood)
        notice.value = {
          text: '按评分和类型推荐。配置 AI 后会结合心情写推荐理由。',
        }
      } else {
        try {
          result = await aiPicks(ask, candidates, current.signal)
          notice.value = next.reset
            ? { text: '这些都推荐过一轮了，从头再挑。' }
            : null
        } catch (error) {
          if (current.signal.aborted) return
          const code = error instanceof AiCallError ? error.code : 'network'
          result = localPicks(candidates, ask.mood)
          notice.value =
            code === 'not_configured'
              ? {
                  text: 'AI 还没配置，先按评分和类型推荐。',
                  configure: true,
                }
              : { text: 'AI 暂时不可用，先按评分和类型推荐。' }
        }
      }
      if (current.signal.aborted) return
      result.forEach(p => shown.add(p.candidate.id))
      picks.value = result
    } catch (error) {
      if (!current.signal.aborted)
        notice.value = { text: `读取媒体库失败：${errorText(error)}` }
    } finally {
      if (controller === current) {
        controller = null
        busy.value = null
      }
    }
  }

  /** 面板关闭：取消没回来的调用 */
  function cancel(): void {
    controller?.abort()
    controller = null
    busy.value = null
  }

  return {
    mood,
    time,
    note,
    picks,
    busy,
    notice,
    empty,
    toggleMood,
    recommend,
    cancel,
  }
}
