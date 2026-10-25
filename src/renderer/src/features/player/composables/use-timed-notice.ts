/**
 * 播放区的短暂提示（自动换线路、连播、杜比视界色彩提示等）：显示一段时间后自动消失，
 * 新提示顶掉旧的并重新计时；组件卸载时清掉计时器。
 */
import { type Ref, onBeforeUnmount, ref } from 'vue'

/** 提示停留的毫秒数 */
const NOTICE_MS = 4000

/**
 * 短暂提示。
 * @returns notice 当前文字（空串为不显示）；show 显示一条
 */
export function useTimedNotice(): {
  notice: Ref<string>
  show: (text: string) => void
} {
  const notice = ref('')
  let timer: number | undefined
  const show = (text: string): void => {
    notice.value = text
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      notice.value = ''
    }, NOTICE_MS)
  }
  onBeforeUnmount(() => {
    if (timer) window.clearTimeout(timer)
  })
  return { notice, show }
}
