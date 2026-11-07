import { type ComputedRef, type Ref, computed, ref, watch } from 'vue'

interface SettingsPages {
  showCategories: ComputedRef<boolean>
  reset(direct: boolean): void
  enter(id: string): Promise<void>
  back(): Promise<void>
}

/** 手机设置分级导航；分区切换和返回都沿用当前内容的离开确认。 */
export function useSettingsPages(options: {
  phone: Ref<boolean>
  select: (id: string) => boolean | Promise<boolean>
  canLeave: () => boolean | Promise<boolean>
}): SettingsPages {
  const detail = ref(false)
  let version = 0

  // 分屏收窄时保持当前编辑器挂载，避免丢失尚未保存的表单。
  watch(
    options.phone,
    (phone, previous) => {
      if (phone && !previous) detail.value = true
    },
    { flush: 'sync' }
  )

  return {
    showCategories: computed(() => options.phone.value && !detail.value),
    reset(direct: boolean): void {
      version++
      detail.value = direct
    },
    async enter(id: string): Promise<void> {
      const request = ++version
      if ((await options.select(id)) && request === version) detail.value = true
    },
    async back(): Promise<void> {
      const request = ++version
      if ((await options.canLeave()) && request === version)
        detail.value = false
    },
  }
}
