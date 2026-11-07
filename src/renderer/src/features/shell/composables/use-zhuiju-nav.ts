/**
 * 侧栏用的 115 登录态：进应用时读一次账号。
 * 退出后如果还停在追剧日历或自动追更，回到登录页。
 */
import { type ComputedRef, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  netdiskAccount,
  netdiskAccountFailed,
  netdiskAccountKnown,
  refreshNetdiskAccount,
} from '@/features/netdisk'

import { zhuijuLoginRedirect } from './nav-items'

/** 侧栏要的登录态：ready 为真才显示追剧组。 */
export interface ZhuijuNav {
  ready: ComputedRef<boolean>
  failed: ComputedRef<boolean>
  loggedIn: ComputedRef<boolean>
}

/** 是否已登录 115。外壳把它放进 NavState。 */
export function useZhuijuNav(): ZhuijuNav {
  const route = useRoute()
  const router = useRouter()
  onMounted(() => {
    void refreshNetdiskAccount()
  })
  watch(
    () => netdiskAccount.value?.loggedIn === true,
    loggedIn => {
      const redirect = zhuijuLoginRedirect(route.name, loggedIn)
      if (redirect) void router.replace(redirect)
    }
  )
  return {
    ready: computed(() => netdiskAccountKnown.value),
    failed: computed(() => netdiskAccountFailed.value),
    loggedIn: computed(() => netdiskAccount.value?.loggedIn === true),
  }
}
