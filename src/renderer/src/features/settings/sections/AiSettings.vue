<template>
  <SettingsGroup title="模型服务">
    <SettingsRow title="服务商" :description="providerHint">
      <UiSelect
        v-model="provider"
        :options="providerOptions"
        aria-label="AI 服务商"
        class="settings-field is-inline"
      />
    </SettingsRow>
    <SettingsRow
      title="接口地址"
      :description="
        provider === 'custom'
          ? 'OpenAI 兼容接口，填到 /v1 为止'
          : '留空使用服务商默认地址'
      "
    >
      <UiInput
        v-model="baseUrl"
        type="text"
        aria-label="接口地址"
        :placeholder="preset.baseUrl || 'https://example.com/v1'"
        class="settings-field is-inline"
      />
    </SettingsRow>
    <SettingsRow
      v-if="provider !== 'ollama'"
      title="API Key"
      :description="
        keySaved && !editingKey
          ? '已加密保存在系统钥匙串，不回显'
          : '保存后加密存放，只在本机使用'
      "
    >
      <template v-if="keySaved && !editingKey">
        <UiButton size="sm" label="更换" @click="startEditKey" />
        <UiButton size="sm" variant="plain" label="清除" @click="clearKey" />
      </template>
      <template v-else>
        <UiInput
          v-model="keyDraft"
          v-enter="saveKey"
          type="password"
          autocomplete="off"
          aria-label="API Key"
          placeholder="输入 API Key"
          class="settings-field is-key"
        />
        <UiButton
          size="sm"
          label="保存"
          :disabled="!keyDraft.trim()"
          :loading="savingKey"
          @click="saveKey"
        />
        <UiButton
          v-if="keySaved"
          size="sm"
          variant="plain"
          label="取消"
          @click="cancelEditKey"
        />
      </template>
    </SettingsRow>
    <SettingsRow title="对话模型" description="留空使用服务商推荐模型">
      <UiInput
        v-model="model"
        type="text"
        aria-label="对话模型"
        :placeholder="preset.model || '模型名'"
        class="settings-field is-inline"
      />
    </SettingsRow>
    <SettingsRow title="测试连接" :description="testText">
      <UiButton
        size="sm"
        label="测试连接"
        :loading="testing"
        @click="runTest"
      />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup title="隐私">
    <SettingsRow
      title="私密板块只用本地模型"
      description="私密板块的内容只发给本机或局域网里的模型；当前服务商不是本地时，相关 AI 功能直接停用"
    >
      <UiSwitch v-model="privateLocalOnly" label="私密板块只用本地模型" />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup title="语音识别" footer="AI 字幕使用这里的语音识别设置">
    <SettingsRow title="识别方式">
      <UiSelect
        v-model="speechEngine"
        :options="speechOptions"
        aria-label="语音识别方式"
        class="settings-field is-inline"
      />
    </SettingsRow>
    <SettingsRow
      v-if="speechEngine !== 'off'"
      title="识别模型"
      :description="
        speechEngine === 'local-whisper'
          ? 'whisper.cpp 模型名，例如 large-v3-turbo'
          : '云端转写模型，例如 whisper-1'
      "
    >
      <UiInput
        v-model="speechModel"
        type="text"
        aria-label="识别模型"
        class="settings-field is-inline"
      />
    </SettingsRow>
    <SettingsRow
      v-if="speechEngine === 'local-whisper'"
      title="whisper-cli 路径"
      description="whisper.cpp 的可执行文件（绝对路径）；留空在 PATH 里找 whisper-cli"
    >
      <UiInput
        :value="whisperBin"
        type="text"
        aria-label="whisper-cli 路径"
        placeholder="whisper-cli"
        class="settings-field is-inline"
        @change="onWhisperBinChange"
      />
    </SettingsRow>
    <SettingsRow
      v-if="speechEngine === 'local-whisper'"
      title="模型文件"
      description="ggml 模型文件（绝对路径）；留空用 AI 数据目录 whisper 文件夹里的 ggml-<识别模型>.bin"
    >
      <UiInput
        :value="whisperModelPath"
        type="text"
        aria-label="Whisper 模型文件"
        placeholder="ggml-large-v3-turbo.bin"
        class="settings-field is-inline"
        @change="onWhisperModelChange"
      />
    </SettingsRow>
    <SettingsRow
      v-if="speechEngine === 'cloud'"
      title="转写接口地址"
      description="OpenAI 兼容 /audio/transcriptions；留空与对话用同一个接口和 Key"
    >
      <UiInput
        v-model="speechBaseUrl"
        type="text"
        aria-label="转写接口地址"
        placeholder="与对话接口相同"
        class="settings-field is-inline"
      />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup
    title="前情提要 · 问剧情"
    footer="前情提要：概括之前 1–3 集（每集用字幕，没有字幕时用分集简介）。问剧情：之前几集同上，本集只用当前进度之前的字幕，不用分集简介；在播放器设置菜单或右键里打开"
  >
    <SettingsRow
      title="开播时提示前情提要"
      description="已配置 AI 时，剧集第 2 集起从头播放会在播放器左上角浮出提示，点开再生成"
    >
      <UiSwitch v-model="recapPrompt" label="开播时提示前情提要" />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup title="用量">
    <SettingsRow
      title="本月用量"
      description="按服务商返回的 tokens 累计，只统计成功的请求"
    >
      <span class="settings-usage">{{ usageText }}</span>
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · AI：所有 AI 功能共用的模型配置（ai.*）。
 *
 * 服务商 / 接口地址 / 模型即改即存；API Key 每个服务商各一份密钥，只写不读，
 * 「保存」交主进程加密存放；「测试连接」用当前设置发一条最短对话；本月用量跟随 usageChanged 更新。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { toast } from '@/components/ui'
import { vEnter } from '@/directives/enter'
import {
  AI_PROVIDERS,
  type AiMonthUsage,
  aiAvailable,
  aiKeyConfigured,
  aiProviderPreset,
  formatMonthUsage,
  getAiUsage,
  isLocalEndpoint,
  onAiUsageChanged,
  setAiKey,
  testAiConnection,
} from '@/features/ai'

import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import { setSetting, useSetting } from '../use-setting'

const providerOptions = AI_PROVIDERS.map(p => ({ value: p.id, label: p.label }))
const speechOptions = [
  { value: 'off', label: '关闭' },
  { value: 'local-whisper', label: '本地 Whisper' },
  { value: 'cloud', label: '云端转写接口' },
]

const provider = useSetting('ai.provider')
const baseUrl = useSetting('ai.baseUrl')
const model = useSetting('ai.model')
const privateLocalOnly = useSetting('ai.privateLocalOnly')
const speechEngine = useSetting('ai.speech.engine')
const speechModel = useSetting('ai.speech.model')
const speechBaseUrl = useSetting('ai.speech.baseUrl')
const whisperBin = useSetting('ai.speech.whisperBin')
const whisperModelPath = useSetting('ai.speech.whisperModelPath')
const recapPrompt = useSetting('ai.recap.prompt')

/** 路径输入失焦 / 回车后才保存（逐字保存会把半截路径当成不合法） */
function inputText(event: Event): string {
  return (event.target as HTMLInputElement).value.trim()
}

async function savePath(
  key: 'ai.speech.whisperBin' | 'ai.speech.whisperModelPath',
  event: Event
): Promise<void> {
  try {
    await setSetting(key, inputText(event))
  } catch {
    toast.error('请填写完整的绝对路径')
  }
}

function onWhisperBinChange(event: Event): void {
  void savePath('ai.speech.whisperBin', event)
}

function onWhisperModelChange(event: Event): void {
  void savePath('ai.speech.whisperModelPath', event)
}

const preset = computed(() => aiProviderPreset(provider.value))
/** 当前服务商是否算本地（Ollama，或地址指向本机 / 局域网） */
const isLocal = computed(
  () =>
    provider.value === 'ollama' ||
    isLocalEndpoint(baseUrl.value || preset.value.baseUrl)
)
const providerHint = computed(() =>
  isLocal.value
    ? '本地模型：内容不离开本机 / 局域网'
    : '云端模型：内容会发给服务商'
)

// ── API Key ────────────────────────────────────────────
const keySaved = computed(() => aiKeyConfigured(provider.value))
const editingKey = ref(false)
const keyDraft = ref('')
const savingKey = ref(false)

function startEditKey(): void {
  editingKey.value = true
}

function cancelEditKey(): void {
  editingKey.value = false
  keyDraft.value = ''
}

async function saveKey(): Promise<void> {
  const value = keyDraft.value.trim()
  if (!value || savingKey.value) return
  savingKey.value = true
  try {
    await setAiKey(provider.value, value)
    cancelEditKey()
    toast.success('API Key 已保存')
  } catch (error) {
    toast.error(`保存失败：${(error as Error).message}`)
  } finally {
    savingKey.value = false
  }
}

async function clearKey(): Promise<void> {
  try {
    await setAiKey(provider.value, '')
  } catch (error) {
    toast.error(`清除失败：${(error as Error).message}`)
  }
}

watch(provider, () => {
  cancelEditKey()
  testText.value = ''
})

// ── 测试连接 ───────────────────────────────────────────
const testing = ref(false)
const testText = ref('')

async function runTest(): Promise<void> {
  if (testing.value) return
  testing.value = true
  testText.value = ''
  try {
    const result = await testAiConnection()
    testText.value = result.ok
      ? `连接正常 · ${result.model} · ${result.latencyMs} ms`
      : `连接失败：${result.message ?? '未知错误'}`
  } catch (error) {
    testText.value = `连接失败：${(error as Error).message}`
  } finally {
    testing.value = false
  }
}

// ── 本月用量 ───────────────────────────────────────────
const usage = ref<AiMonthUsage | null>(null)
const usageText = computed(() =>
  usage.value
    ? formatMonthUsage(usage.value)
    : aiAvailable()
      ? '读取中…'
      : '仅桌面端统计'
)
let stopUsage: (() => void) | undefined
onMounted(() => {
  if (!aiAvailable()) return
  stopUsage = onAiUsageChanged(summary => {
    usage.value = summary.current
  })
  getAiUsage()
    .then(summary => {
      usage.value = summary.current
    })
    .catch(() => {
      usage.value = null
    })
})
onBeforeUnmount(() => stopUsage?.())
</script>

<style scoped>
.settings-field.is-inline {
  width: 260px;
  max-width: 100%;
}
.settings-field.is-key {
  width: 200px;
  max-width: 100%;
}
.settings-usage {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
@media (max-width: 720px) {
  .settings-field.is-inline,
  .settings-field.is-key {
    width: 100%;
  }
}
</style>
