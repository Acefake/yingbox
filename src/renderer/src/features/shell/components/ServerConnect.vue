<template>
  <div class="server-connect" :role="state === 'offline' ? 'alert' : undefined">
    <UiIcon :name="state === 'offline' ? 'warning' : 'lock'" size="lg" />
    <template v-if="state === 'offline'">
      <h2>连不上片库服务</h2>
      <p>
        网页端的内容由独立的片库服务提供。请确认它在运行（Docker 里看
        <code>docker compose ps</code> 与日志），再刷新本页。
      </p>
      <UiButton icon="refresh" label="重试" @click="reload" />
    </template>
    <template v-else>
      <h2>登录片库服务</h2>
      <p>这台片库服务设置了访问令牌，输入 YINGBOX_SERVER_TOKEN 的值登录。</p>
      <form class="server-connect__form" @submit.prevent="connect">
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
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 网页端连接片库服务：连不上时说明怎么检查；服务设了访问令牌且回 401（没登录过、令牌换了、Cookie 过期）时输入令牌。
 * 服务默认不鉴权（/api/health 回 authorized: true），这时状态直接是 online，外壳不会显示本组件。
 * 由外壳在内容区统一显示，首页、片库、日历等页面都不用各自判断。
 * 登录成功后整页刷新：片库状态与各条事件流从头建立，比逐个模块重连简单可靠。
 */
import { ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiInput from '@/components/ui/UiInput.vue'
import {
  type LibraryServerState,
  loginLibraryServer,
} from '@/services/library-server'

defineProps<{
  state: LibraryServerState
}>()

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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  height: 100%;
  padding: var(--space-11) var(--space-8);
  color: var(--text-tertiary);
  text-align: center;
}
.server-connect .app-icon {
  width: 48px;
  height: 48px;
  color: var(--text-quaternary);
}
.server-connect h2 {
  margin: var(--space-2) 0 0;
  color: var(--text-primary);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
}
.server-connect p {
  max-width: 420px;
  margin: 0 0 var(--space-4);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
.server-connect__form {
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
