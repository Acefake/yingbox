<template>
  <NetdiskView v-if="showSearch" />
  <div v-else class="netdisk-pending">
    <UiLoadingDots v-if="loading" label="正在读取网盘账号" />
    <StatusState
      v-else
      tone="danger"
      title="读取网盘账号失败"
      hint="稍后再试。登录状态确认前，追剧日历和自动追更先不打开。"
    >
      <UiButton size="sm" label="重试" @click="loadAccount" />
    </StatusState>
  </div>
</template>

<script setup lang="ts">
/**
 * 网盘路由：115 未登录时进入存储管理，登录后是网盘搜剧。
 * 平台没有网盘时仍进入搜索页，由它说明需要桌面端或片库服务。
 * 账号还没读到时停在读取中；读失败可以重试，不会把人当成已确认未登录。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'

import {
  netdiskAccount,
  netdiskAccountKnown,
  netdiskAvailable,
  refreshNetdiskAccount,
} from '../api'
import NetdiskView from './NetdiskView.vue'

const loading = ref(false)
const router = useRouter()
const showLogin = computed(
  () =>
    netdiskAvailable &&
    netdiskAccountKnown.value &&
    netdiskAccount.value?.loggedIn === false
)
const showSearch = computed(
  () =>
    !netdiskAvailable ||
    (netdiskAccountKnown.value && netdiskAccount.value?.loggedIn === true)
)

watch(
  showLogin,
  login => {
    if (login) void router.replace('/storage')
  },
  { immediate: true }
)

async function loadAccount(): Promise<void> {
  if (!netdiskAvailable || netdiskAccountKnown.value) return
  loading.value = true
  await refreshNetdiskAccount()
  loading.value = false
}

onMounted(() => {
  void loadAccount()
})
</script>

<style scoped>
.netdisk-pending {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>
