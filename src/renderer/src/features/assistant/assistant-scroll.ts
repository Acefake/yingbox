/**
 * 对话流的「贴底」自动滚动：回答逐字输出、新结果出现时，只有用户停在底部附近时才跟到底部；
 * 用户主动往上翻看旧轮次时暂停，滚回底部附近（{@link STICK_GAP} 以内）再恢复。
 * 用户自己开始新的一轮（提问、开始录音）时强制贴底。
 */
import { type Ref, nextTick } from 'vue'

/** 离底部多少像素以内算「贴近底部」 */
export const STICK_GAP = 48

/** 判断贴底需要的滚动量 */
export interface ScrollBox {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/**
 * 是否贴近底部（纯函数）。
 * @param box 滚动容器的尺寸
 * @param gap 容差（像素）
 */
export function nearBottom(box: ScrollBox, gap = STICK_GAP): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= gap
}

/** useStickyScroll 的返回值 */
export interface StickyScroll {
  /** 绑定到容器的 scroll 事件：记下用户此刻是否贴底 */
  onScroll: () => void
  /** 内容变化后调用：贴底时滚到底部，否则不动 */
  follow: () => void
  /** 用户开始新的一轮：恢复贴底并滚到底部 */
  stick: () => void
}

/**
 * 对话流容器的贴底滚动。
 * @param el 滚动容器
 */
export function useStickyScroll(el: Ref<HTMLElement | null>): StickyScroll {
  let pinned = true

  function toBottom(): void {
    void nextTick(() => {
      const box = el.value
      if (box) box.scrollTop = box.scrollHeight
    })
  }

  return {
    onScroll: () => {
      if (el.value) pinned = nearBottom(el.value)
    },
    follow: () => {
      if (pinned) toBottom()
    },
    stick: () => {
      pinned = true
      toBottom()
    },
  }
}
