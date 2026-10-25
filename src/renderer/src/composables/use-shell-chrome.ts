import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
} from 'vue'

/**
 * 外壳浮动控件与页面之间的约定：铺满窗口、自带玻璃返回圆钮的页面（条目详情，效果图 D-1）
 * 挂载期间登记一次，外壳的前进 / 后退胶囊让位，避免左上角出现两个返回键。
 */

/** 正在显示自带返回键的页面数（keep-alive 停用时也减掉） */
const ownBackCount = ref(0)

/** 是否有页面自带返回键（外壳据此隐藏前进 / 后退胶囊） */
export const pageOwnsBack = computed(() => ownBackCount.value > 0)

/** 在组件 setup 里调用：组件显示期间外壳隐藏前进 / 后退胶囊 */
export function useOwnBackButton(): void {
  let held = false
  const hold = (): void => {
    if (held) return
    held = true
    ownBackCount.value++
  }
  const release = (): void => {
    if (!held) return
    held = false
    ownBackCount.value--
  }
  onMounted(hold)
  onActivated(hold)
  onDeactivated(release)
  onUnmounted(release)
}
