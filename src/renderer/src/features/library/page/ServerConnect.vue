<template>
  <LibraryEmpty
    v-if="state === 'offline'"
    :icon="kind"
    title="连不上片库服务"
    text="网页端的媒体库由独立的片库服务提供。请在电脑或 NAS 上启动它（pnpm dev:server，或 Docker），再刷新本页。"
  >
    <UiButton icon="refresh" label="重试" @click="reload" />
  </LibraryEmpty>
  <LibraryEmpty
    v-else-if="state === 'unauthorized'"
    :icon="kind"
    title="登录片库服务"
    text="输入服务启动日志里的访问令牌（或环境变量 YINGBOX_SERVER_TOKEN 的值）。"
  >
    <form class="server-connect" @submit.prevent="connect">
      <UiInput
        v-model="token"
        type="password"
        placeholder="访问令牌"
        autocomplete="current-password"
        :invalid="Boolean(error)"
        class="server-connect__input"
      />
      <UiButton
        type="submit"
        variant="primary"
        label="连接"
        :loading="busy"
        :disabled="!token.trim()"
      />
    </form>
    <p v-if="error" class="server-connect__error" role="alert">{{ error }}</p>
  </LibraryEmpty>
</template>

<script setup lang="ts">
/**
 * 网页端连接片库服务的空状态：连不上时说明怎么启动服务；需要登录时输入令牌。
 * 登录成功后整页刷新：片库状态与事件流从头建立，比逐个模块重连简单可靠。
 */
import { ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import {
  type LibraryServerState,
  loginLibraryServer,
} from '@/services/library-server'
import LibraryEmpty from './LibraryEmpty.vue'

defineProps<{ state: LibraryServerState; kind: 'movie' | 'tv' }>()

const token = ref('')
const busy = ref(false)
const error = ref('')

function reload(): void {
  window.location.reload()
}

async function connect(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    await loginLibraryServer(token.value)
    reload()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.server-connect {
  display: flex;
  gap: var(--space-2);
  width: min(360px, 100%);
}
.server-connect__input {
  flex: 1;
}
.server-connect__error {
  color: var(--danger);
}
</style>
