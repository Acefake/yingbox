<template>
  <Teleport to="body">
    <div
      v-if="pending"
      class="section-lock"
      role="dialog"
      aria-modal="true"
      :aria-label="`解锁${pending.title}`"
    >
      <div v-if="isElectron" class="section-lock__titlebar">
        <WinControls />
      </div>
      <form class="section-lock__card" @submit.prevent="submit">
        <UiIcon name="lock" size="lg" class="section-lock__icon" />
        <p class="section-lock__title">「{{ pending.title }}」已锁定</p>
        <p class="section-lock__hint">{{ hint }}</p>
        <UiInput
          ref="input"
          v-model="password"
          type="password"
          placeholder="应用密码"
          autocomplete="current-password"
          :invalid="Boolean(error)"
          :disabled="busy || waiting"
        />
        <p v-if="error" class="section-lock__error" role="alert">
          {{ error }}
        </p>
        <div class="section-lock__actions">
          <UiButton
            v-if="touchId"
            icon="lock"
            label="使用 Touch ID"
            :disabled="busy"
            @click="promptTouchId"
          />
          <span class="section-lock__spacer" />
          <UiButton label="取消" :disabled="busy" @click="cancel" />
          <UiButton
            variant="primary"
            label="解锁"
            :loading="busy"
            :disabled="!password || waiting"
            @click="submit"
          />
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 板块解锁界面（应用根组件挂载一次）：有解锁请求时盖住窗口，输入应用密码或用 Touch ID 解锁。
 * 打开时如果可用 Touch ID 会先自动弹一次系统认证；Esc / 取消放弃进入。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import WinControls from '@/components/WinControls.vue'
import { UiButton, UiIcon, UiInput } from '@/components/ui'
import { useEscapeLayer } from '@/composables/use-escape-layer'

import { sectionLockStatus, unlockRequest } from './lock-state'
import { retryText } from './rules'

const request = unlockRequest()
const status = sectionLockStatus()
const pending = computed(() => request.value)
const touchId = computed(() => status.value.systemAuth === 'touchid')
const isElectron = Boolean(window.api?.win)

const password = ref('')
const error = ref('')
const busy = ref(false)
/** 连续输错被暂停中 */
const waiting = ref(false)
const input = ref<{ focus: () => void } | null>(null)
let waitTimer: number | undefined

const hint = computed(() =>
  touchId.value ? '输入应用密码，或使用 Touch ID 解锁' : '输入应用密码解锁'
)

function finish(ok: boolean): void {
  const current = request.value
  password.value = ''
  error.value = ''
  current?.resolve(ok)
}

function cancel(): void {
  finish(false)
}

function pause(retryAfterMs: number): void {
  waiting.value = true
  error.value = retryText(retryAfterMs)
  window.clearTimeout(waitTimer)
  waitTimer = window.setTimeout(() => {
    waiting.value = false
    error.value = ''
  }, retryAfterMs)
}

async function submit(): Promise<void> {
  const bridge = window.api?.sectionLock
  if (!bridge || !password.value || busy.value || waiting.value) return
  busy.value = true
  try {
    const result = await bridge.verify(password.value)
    if (result.ok) return finish(true)
    password.value = ''
    if (result.retryAfterMs > 0) pause(result.retryAfterMs)
    else error.value = '密码不正确'
  } catch (cause) {
    error.value = (cause as Error).message
  } finally {
    busy.value = false
  }
}

async function promptTouchId(): Promise<void> {
  const bridge = window.api?.sectionLock
  const current = request.value
  if (!bridge || !current || busy.value) return
  busy.value = true
  try {
    const ok = await bridge.promptSystem(`解锁「${current.title}」`)
    if (ok && request.value === current) finish(true)
  } finally {
    busy.value = false
  }
}

watch(pending, async current => {
  if (!current) return
  await nextTick()
  input.value?.focus()
  if (touchId.value) void promptTouchId()
})

useEscapeLayer(() => Boolean(pending.value), cancel)

onBeforeUnmount(() => window.clearTimeout(waitTimer))
</script>

<style scoped>
.section-lock {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: var(--overlay-scrim);
  backdrop-filter: blur(12px);
}

.section-lock__titlebar {
  position: absolute;
  inset: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: var(--titlebar-height);
  padding: 0 var(--space-3);
  -webkit-app-region: drag;
}

.section-lock__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  width: min(360px, 100%);
  padding: var(--space-6);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
}

.section-lock__icon {
  color: var(--text-secondary);
}

.section-lock__title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
}

.section-lock__hint {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.section-lock__error {
  margin: 0;
  align-self: stretch;
  font-size: var(--text-sm);
  color: var(--danger);
}

.section-lock__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  align-self: stretch;
  margin-top: var(--space-2);
}

.section-lock__spacer {
  flex: 1;
}
</style>
