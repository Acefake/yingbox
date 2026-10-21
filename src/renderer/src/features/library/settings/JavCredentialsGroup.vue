<template>
  <SettingsGroup
    title="站点凭据"
    footer="凭据只保存在片库里，不会回显；清空后保存即删除。"
  >
    <SettingsRow
      v-for="field in JAV_CREDENTIAL_FIELDS"
      :key="field.provider"
      :title="field.title"
      stacked
    >
      <template #description>
        {{ credentialStatus(status, field.provider) }}。{{ field.description }}
      </template>
      <form class="jav-cred" @submit.prevent="save(field.provider)">
        <UiInput
          v-model="inputs[field.provider]"
          type="password"
          autocomplete="off"
          :aria-label="field.title"
          :placeholder="
            status?.[field.provider].configured
              ? '已配置，输入新值可替换'
              : field.placeholder
          "
        />
        <UiButton
          type="submit"
          size="sm"
          :label="inputs[field.provider].trim() ? '保存' : '清除'"
          :loading="saving === field.provider"
          :disabled="
            !bridge ||
            (!inputs[field.provider].trim() &&
              !status?.[field.provider].configured)
          "
        />
      </form>
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 番号站点凭据：ThePornDB 令牌、JavDB Cookie、DMM 官方 API。
 * 只回传「是否已配置」，凭据本身不进渲染层状态之外的地方。
 */
import { toast } from '@/components/ui'
import { reactive, ref, watch } from 'vue'

import type {
  JavCredentialProvider,
  ProviderStatus,
} from '../../../../../shared/library/ipc'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'

import { errorText, libraryBridge } from '../api/bridge'
import { JAV_CREDENTIAL_FIELDS, credentialStatus } from './jav-credentials'

const props = defineProps<{ open: boolean }>()

const bridge = libraryBridge()
const status = ref<ProviderStatus>()
const saving = ref<JavCredentialProvider>()
const inputs = reactive<Record<JavCredentialProvider, string>>({
  theporndb: '',
  javdb: '',
  dmm_api: '',
})

async function load(): Promise<void> {
  if (!bridge) return
  try {
    status.value = await bridge.getProviderStatus()
  } catch (error) {
    toast.error(errorText(error))
  }
}

async function save(provider: JavCredentialProvider): Promise<void> {
  if (!bridge) return
  const value = inputs[provider].trim()
  saving.value = provider
  try {
    status.value = await bridge.jav.setCredential(provider, value || null)
    inputs[provider] = ''
    toast.success(value ? '已保存' : '已清除')
  } catch (error) {
    toast.error(errorText(error))
  } finally {
    saving.value = undefined
  }
}

watch(
  () => props.open,
  open => {
    if (open) void load()
  },
  { immediate: true }
)
</script>

<style scoped>
.jav-cred {
  display: flex;
  gap: var(--space-2);
}
.jav-cred > :first-child {
  flex: 1 1 auto;
}
</style>
