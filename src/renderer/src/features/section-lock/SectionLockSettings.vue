<template>
  <SettingsGroup title="应用密码" :footer="passwordFooter">
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
          :disabled="!nextValid"
          @click="savePassword"
        />
        <UiButton
          v-if="status.passwordSet"
          variant="danger"
          label="清除密码"
          :disabled="saving"
          @click="clearPassword"
        />
      </div>
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup title="锁定的板块" :footer="sectionsFooter">
    <SettingsRow
      v-for="section in sections"
      :key="section.name"
      :title="section.title"
    >
      <UiSwitch
        :key="revision"
        :model-value="status.sections.includes(section.name)"
        :label="`锁定${section.title}`"
        :disabled="!status.passwordSet"
        @update:model-value="toggle(section, $event)"
      />
    </SettingsRow>
    <SettingsRow
      title="自动重新锁定"
      description="解锁后离开板块或窗口隐藏超过这段时间，再进入时重新验证"
    >
      <UiSelect
        :key="revision"
        :model-value="status.relockMinutes"
        :options="relockOptions"
        :disabled="!status.passwordSet"
        @update:model-value="setRelock"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 板块锁：设置 / 修改 / 清除应用密码（主进程 scrypt 哈希保存），
 * 勾选要锁的板块（列表读应用入口传入的路由表），离开后多久重新锁定；锁的配置保存在主进程。
 *
 * 降低保护的操作（修改 / 清除密码、取消某个板块的锁定、放宽重新锁定）先弹解锁界面验证身份
 * （应用密码或 Touch ID），拿到主进程签发的一次性凭据再写入；主进程写入时再校验凭据。
 * 增加锁定、收紧重新锁定不需要验证。没设密码时不能开锁；清除密码会一并取消全部锁定。
 */
import { computed, onMounted, ref } from 'vue'

import { UiButton, UiInput, UiSelect, UiSwitch, toast } from '@/components/ui'
import { SettingsGroup, SettingsRow, getSetting } from '@/features/settings'

import { parseLockPassword } from '../../../../shared/section-lock'
import {
  type GuardedWrite,
  refreshLockStatus,
  requestAuthorization,
  saveLockConfig,
  sectionLockStatus,
} from './lock-state'
import {
  type LockableRoute,
  type LockableSection,
  RELOCK_OPTIONS,
  lockableSections,
} from './rules'

const props = defineProps<{
  /** 路由表（由应用入口传入；可锁的板块从这里读） */
  routes: readonly LockableRoute[]
}>()

const status = sectionLockStatus()
const relockOptions = RELOCK_OPTIONS.map(option => ({ ...option }))
const sections = computed(() =>
  lockableSections(props.routes, getSetting('app.adultMode'))
)

const next = ref('')
const saving = ref(false)
/** 每次写入结束 +1：取消验证或被拒时让开关 / 下拉框回到实际保存的值 */
const revision = ref(0)
const nextValid = computed(() => parseLockPassword(next.value) !== undefined)

const passwordFooter = computed(() => {
  const system =
    status.value.systemAuth === 'touchid'
      ? '解锁时也可以用 Touch ID。'
      : '当前系统没有可调用的系统认证，解锁时输入应用密码。'
  return `密码至少 4 个字符，只保存加密哈希。修改或清除密码前需要先验证。${system}`
})
const sectionsFooter =
  '进入时需要输入应用密码或通过系统认证；取消锁定或放宽自动锁定前需要先验证'

onMounted(() => void refreshLockStatus().catch(() => {}))

/** 提示一次受保护写入的结果 */
function report(result: GuardedWrite, success?: string): void {
  if (result === 'saved' && success) toast.success(success)
  if (result === 'rejected') toast.error('验证已失效，请重新操作')
}

/** 已设密码时先验证身份拿凭据；没设密码时不需要（空串）。取消返回 null */
async function authorize(reason: string): Promise<string | null> {
  if (!status.value.passwordSet) return ''
  return (await requestAuthorization(reason)) || null
}

async function guarded(
  run: () => Promise<GuardedWrite>,
  success?: string
): Promise<void> {
  saving.value = true
  try {
    report(await run(), success)
  } catch (error) {
    toast.error((error as Error).message)
  } finally {
    saving.value = false
    revision.value += 1
  }
}

function savePassword(): Promise<void> {
  const bridge = window.api?.sectionLock
  const value = next.value
  if (!bridge || parseLockPassword(value) === undefined)
    return Promise.resolve()
  return guarded(async () => {
    const grant = await authorize('修改应用密码前需要验证')
    if (grant === null) return 'cancelled'
    const ok = await bridge.setPassword(grant, value)
    await refreshLockStatus()
    if (ok) next.value = ''
    return ok ? 'saved' : 'rejected'
  }, '应用密码已保存')
}

function clearPassword(): Promise<void> {
  const bridge = window.api?.sectionLock
  if (!bridge) return Promise.resolve()
  return guarded(async () => {
    const grant = await authorize('清除应用密码前需要验证')
    if (grant === null) return 'cancelled'
    const ok = await bridge.clearPassword(grant)
    await refreshLockStatus()
    return ok ? 'saved' : 'rejected'
  }, '应用密码已清除，板块锁已全部关闭')
}

function toggle(section: LockableSection, on: boolean): Promise<void> {
  const { sections: locked, relockMinutes } = status.value
  const rest = locked.filter(item => item !== section.name)
  const config = {
    sections: on ? [...rest, section.name] : rest,
    relockMinutes,
  }
  return guarded(() =>
    saveLockConfig(config, `取消「${section.title}」的锁定前需要验证`)
  )
}

function setRelock(value: unknown): Promise<void> {
  const minutes = Number(value)
  const config = { sections: status.value.sections, relockMinutes: minutes }
  return guarded(() => saveLockConfig(config, '放宽自动重新锁定前需要验证'))
}
</script>

<style scoped>
.section-lock-settings__actions {
  display: flex;
  gap: var(--space-2);
}
</style>
