/**
 * 无痕模式：会话级开关，只在内存里（不持久化，重启应用恢复关闭）。
 *
 * 打开时不写任何观看痕迹，所有写入点统一经 isIncognito() 判断：
 * - 续播进度（player/utils/play-progress 的 saveMediaProgress，含在线播放历史里的进度）；
 * - 继续播放（player/continue/continue-store 的 startContinue / updateContinue）；
 * - 在线播放历史（online/components/DetailWindow 的 recordHistory）；
 * - AV 播放历史（av/composables/use-av-playback 的 startPlay）。
 * 读取（续播起点、继续播放横排）照常；用户在界面上的删除 / 标记看完不受影响。
 */
import { type Ref, readonly, ref } from 'vue'

const active = ref(false)

/** 当前是否无痕（在 computed / 模板里读即为响应式）。 */
export function isIncognito(): boolean {
  return active.value
}

/** 打开 / 关闭无痕模式。 */
export function setIncognito(on: boolean): void {
  active.value = on
}

/** 切换；返回切换后的状态。 */
export function toggleIncognito(): boolean {
  active.value = !active.value
  return active.value
}

/** 只读的响应式状态（侧栏开关与标识用）。 */
export function incognitoState(): Readonly<Ref<boolean>> {
  return readonly(active)
}
