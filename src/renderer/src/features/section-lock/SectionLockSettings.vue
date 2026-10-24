<template>
  <SettingsGroup title="应用密码" :footer="passwordFooter">
    <SettingsRow v-if="status.passwordSet" stacked>
      <UiInput
        v-model="current"
        type="password"
        placeholder="当前密码"
        autocomplete="current-password"
      />
    </SettingsRow>
    <SettingsRow stacked>
      <UiInput
        v-model="next"
        type="password"
        :placeholder="status.passwordSet ? '新密码' : '设置应用密码'"
        autocomplete="new-password"
        :invalid="Boolean(next) && !nextValid"
      />
    </SettingsRow>
    <SettingsRow stacked>
      <div class="section-lock-settings__actions">
        <UiButton
          variant="primary"
          :label="status.passwordSet ? '修改密码' : '设置密码'"
          :loading="saving"
          :disabled="!nextValid || (status.passwordSet && !current)"
          @click="savePassword"
        />
        <UiButton
          v-if="status.passwordSet"
          variant="danger"
          label="清除密码"
          :disabled="!current || saving"
          @click="clearPassword"
        />
      </div>
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup
    title="锁定的板块"
    footer="进入时需要输入应用密码或通过系统认证；解锁在本次运行中有效"
  >
    <SettingsRow
      v-for="section in sections"
      :key="section.name"
      :title="section.title"
    >
      <UiSwitch
        :model-value="locked.includes(section.name)"
        :label="`锁定${section.title}`"
        :disabled="!status.passwordSet"
        @update:model-value="toggle(section.name, $event)"
      />
    </SettingsRow>
    <SettingsRow
      title="自动重新锁定"
      description="解锁后离开板块或窗口隐藏超过这段时间，再进入时重新验证"
    >
      <UiSelect
        v-model="relockMinutes"
        :options="relockOptions"
        :disabled="!status.passwordSet"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 板块锁：设置 / 修改 / 清除应用密码（主进程 scrypt 哈希保存），
 * 勾选要锁的板块（lock.sections，列表读应用入口传入的路由表），离开后多久重新锁定（lock.relockMinutes）。
 * 没设密码时不能开锁；清除密码会一并取消全部锁定。
 */
import { computed, onMounted, ref } from 'vue'

import { UiButton, UiInput, UiSelect, UiSwitch, toast } from '@/components/ui'
import {
  SettingsGroup,
  SettingsRow,
  getSetting,
  setSetting,
  useSetting,
} from '@/features/settings'

import {
  type LockVerifyResult,
  parseLockPassword,
} from '../../../../shared/section-lock'
import { refreshLockStatus, sectionLockStatus } from './lock-state'
import {
  type LockableRoute,
  RELOCK_OPTIONS,
  lockableSections,
  retryText,
} from './rules'

const props = defineProps<{
  /** 路由表（由应用入口传入；可锁的板块从这里读） */
  routes: readonly LockableRoute[]
}>()

const status = sectionLockStatus()
const relockMinutes = useSetting('lock.relockMinutes')
const relockOptions = RELOCK_OPTIONS.map(option => ({ ...option }))
const locked = computed(() => getSetting('lock.sections'))
const sections = computed(() =>
  lockableSections(props.routes, getSetting('app.adultMode'))
)

const current = ref('')
const next = ref('')
const saving = ref(false)
const nextValid = computed(() => parseLockPassword(next.value) !== undefined)

const passwordFooter = computed(() => {
  const system =
    status.value.systemAuth === 'touchid'
      ? '解锁时也可以用 Touch ID。'
      : '当前系统没有可调用的系统认证，解锁时输入应用密码。'
  return `密码至少 4 个字符，只保存加密哈希，忘记后只能清除重设（需当前密码）。${system}`
})

onMounted(() => void refreshLockStatus().catch(() => {}))

/** 处理一次密码校验结果；通过返回 true */
function accepted(result: LockVerifyResult): boolean {
  if (result.ok) return true
  toast.error(
    result.retryAfterMs > 0 ? retryText(result.retryAfterMs) : '当前密码不正确'
  )
  return false
}

async function savePassword(): Promise<void> {
  const bridge = window.api?.sectionLock
  if (!bridge || !nextValid.value) return
  saving.value = true
  try {
    if (!accepted(await bridge.setPassword(current.value, next.value))) return
    current.value = ''
    next.value = ''
    await refreshLockStatus()
    toast.success('应用密码已保存')
  } catch (error) {
    toast.error((error as Error).message)
  } finally {
    saving.value = false
  }
}

async function clearPassword(): Promise<void> {
  const bridge = window.api?.sectionLock
  if (!bridge) return
  saving.value = true
  try {
    if (!accepted(await bridge.clearPassword(current.value))) return
    current.value = ''
    await setSetting('lock.sections', [])
    await refreshLockStatus()
    toast.success('应用密码已清除，板块锁已全部关闭')
  } catch (error) {
    toast.error((error as Error).message)
  } finally {
    saving.value = false
  }
}

function toggle(name: string, on: boolean): void {
  const rest = locked.value.filter(item => item !== name)
  void setSetting('lock.sections', on ? [...rest, name] : rest).catch(error =>
    toast.error((error as Error).message)
  )
}
</script>

<style scoped>
.section-lock-settings__actions {
  display: flex;
  gap: var(--space-2);
}
</style>
