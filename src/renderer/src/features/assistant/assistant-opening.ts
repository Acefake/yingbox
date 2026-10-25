/**
 * 「正在打开播放器」的互斥状态，在整个侧栏里共享。
 *
 * 对话流里每一轮各挂一个 AssistantResults；正在打开的卡片若只记在单个实例里，快速点一张旧轮卡片
 * 和一张当前轮卡片会各自通过检查，播放器被打开两次。侧栏（AssistantOverlay）用 {@link provideOpening}
 * 提供一份共享状态，每个 AssistantResults 用 {@link useOpening} 取同一份：任何一张卡在打开时，
 * 所有轮次的卡片都变淡、标 aria-disabled，点击被忽略。没有提供时（单独渲染结果）退回实例内的状态。
 */
import { type InjectionKey, type Ref, inject, provide, ref } from 'vue'

/** 正在打开的卡片：哪个结果实例（owner）里的哪张卡 */
export interface OpeningCard {
  owner: number
  cardId: string
}

const OPENING_KEY: InjectionKey<Ref<OpeningCard | null>> =
  Symbol('assistant-opening')

let nextOwner = 1

/** 侧栏里提供共享的「正在打开」状态 */
export function provideOpening(): Ref<OpeningCard | null> {
  const opening = ref<OpeningCard | null>(null)
  provide(OPENING_KEY, opening)
  return opening
}

/** useOpening 的返回值 */
export interface OpeningHandle {
  /** 共享状态（任何一张卡在打开时非空） */
  opening: Ref<OpeningCard | null>
  /** 本实例的编号 */
  owner: number
  /** 这张卡是不是本实例里正在打开的那张 */
  isMine: (cardId: string) => boolean
}

/** 结果组件里取共享的「正在打开」状态（没有提供时用实例内的） */
export function useOpening(): OpeningHandle {
  const opening = inject(OPENING_KEY, () => ref<OpeningCard | null>(null), true)
  const owner = nextOwner++
  return {
    opening,
    owner,
    isMine: cardId =>
      opening.value?.owner === owner && opening.value.cardId === cardId,
  }
}
