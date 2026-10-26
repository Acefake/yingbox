<template>
  <SettingsGroup title="Torznab" :footer="footer">
    <SettingsRow
      title="接口地址"
      description="一行一个；Prowlarr 每个索引器一个，Jackett 可用聚合接口"
      stacked
    >
      <UiTextarea
        v-model="urlsDraft"
        rows="3"
        aria-label="Torznab 接口地址"
        placeholder="http://NAS地址:9696/1/api&#10;http://NAS地址:9117/api/v2.0/indexers/all/results/torznab/api"
        spellcheck="false"
      />
    </SettingsRow>
    <SettingsRow title="API Key" stacked>
      <UiInput
        v-model="keyDraft"
        type="password"
        aria-label="Torznab API Key"
        :placeholder="
          hasKey ? '已保存，留空不改' : 'Prowlarr / Jackett 设置页里的 API Key'
        "
        autocomplete="off"
      />
    </SettingsRow>
    <SettingsRow :description="statusText || undefined">
      <UiButton
        v-if="hasKey"
        size="sm"
        variant="plain"
        label="清除 Key"
        :disabled="busy"
        @click="clearKey"
      />
      <UiButton
        size="sm"
        label="测试连接"
        :loading="testing"
        :disabled="busy || !urls.length"
        @click="test"
      />
      <UiButton
        size="sm"
        variant="primary"
        label="保存"
        :loading="saving"
        :disabled="busy"
        @click="save"
      />
    </SettingsRow>
    <SettingsRow v-if="lines.length" stacked>
      <ul class="torznab-lines" role="status">
        <li v-for="line in lines" :key="line">{{ line }}</li>
      </ul>
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 网盘 · Torznab：接口地址（多行）+ API Key，保存与「测试连接」（t=caps）。
 * Key 只写不读：保存后输入框清空，只显示「已保存」；测试时没填新 Key 就用已保存的。
 * 地址与 Key 存在主进程 / 片库服务的密钥里（与 115 登录同一种存储），网页端同样可用。
 */
import { computed, onMounted, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { toast } from '@/components/ui/toast'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import { isWebRuntime } from '@/services/library-server'
import { MAX_TORZNAB_URLS } from '../../../../../shared/contract/pan115'

import { netdisk } from '../api'
import { errorText } from '../utils/netdisk-rules'

const footer = `磁力来源，搜索时与 PanSou 一起问。地址填 NAS 局域网地址（${
  isWebRuntime()
    ? '片库服务在容器里时，填容器能访问到的地址，不要写 localhost'
    : '本机能访问到即可'
}）。`

const urlsDraft = ref('')
const keyDraft = ref('')
const hasKey = ref(false)
const saving = ref(false)
const testing = ref(false)
const statusText = ref('')
const lines = ref<string[]>([])
const busy = computed(() => saving.value || testing.value)
const urls = computed(() =>
  urlsDraft.value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, MAX_TORZNAB_URLS)
)

async function load(): Promise<void> {
  try {
    const config = await netdisk().torznab()
    urlsDraft.value = config.urls.join('\n')
    hasKey.value = config.hasKey
  } catch (e) {
    statusText.value = `读取 Torznab 配置失败：${errorText(e)}`
  }
}

async function persist(apiKey: string | null): Promise<void> {
  saving.value = true
  try {
    const result = await netdisk().setTorznab(urls.value, apiKey)
    if (!result.ok) throw new Error(result.error)
    keyDraft.value = ''
    await load()
    toast.success('Torznab 设置已保存')
  } catch (e) {
    toast.error(`保存失败：${errorText(e)}`)
  } finally {
    saving.value = false
  }
}

function save(): Promise<void> {
  return persist(keyDraft.value.trim() || null)
}

function clearKey(): Promise<void> {
  return persist('')
}

async function test(): Promise<void> {
  testing.value = true
  lines.value = []
  statusText.value = ''
  try {
    const result = await netdisk().testTorznab(
      urls.value,
      keyDraft.value.trim() || null
    )
    lines.value = result.ok ? result.lines : result.error.split('\n')
    statusText.value = result.ok ? '连接正常' : '有地址连不上'
  } catch (e) {
    statusText.value = `测试失败：${errorText(e)}`
  } finally {
    testing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.torznab-lines {
  margin: 0;
  padding-left: var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  word-break: break-all;
}
</style>
