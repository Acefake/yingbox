<template>
  <div class="amane-settings">
    <nav class="amane-settings-nav" aria-label="Amane 设置分组">
      <UiNavItem
        v-if="!isWeb"
        label="连接与存储"
        :active="activeSection === 'connection'"
        @click="selectSection('connection')"
      />
      <UiNavItem
        v-if="!isWeb"
        label="手机接入"
        :active="activeSection === 'phone'"
        @click="selectSection('phone')"
      />
      <UiNavItem
        v-for="key in configSections"
        :key="key"
        :label="sectionLabel(key)"
        :active="activeSection === key"
        @click="selectSection(key)"
      />
    </nav>

    <main class="amane-settings-content">
      <section
        v-if="isWeb && ['connection', 'phone'].includes(activeSection)"
        class="amane-settings-page"
      >
        <h2>连接设置</h2>
        <p class="amane-muted">
          连接方式由桌面客户端管理。手机端通过桌面端生成的「手机接入链接」绑定后即可使用片库与配置。
        </p>
      </section>

      <section
        v-else-if="activeSection === 'connection'"
        class="amane-settings-page"
      >
        <h2>连接与存储</h2>
        <p class="amane-muted">管理 Amane 后台连接方式与片库数据位置。</p>
        <p v-if="error" class="amane-error" role="alert">{{ error }}</p>
        <form @submit.prevent="saveConnection">
          <div class="amane-form-group">
            <label class="amane-form-row"
              ><span>运行方式</span
              ><UiSelect v-model="form.mode">
                <option value="managed">由影盒管理后台</option>
                <option value="external">连接已有服务</option>
              </UiSelect></label
            >
            <label v-if="form.mode === 'managed'" class="amane-form-row">
              <span>后台程序</span>
              <div class="amane-form-control">
                <UiInput
                  v-model="form.executablePath"
                  placeholder="选择安装目录内的 Amane.Server.exe"
                /><UiIconButton
                  icon="folder"
                  label="选择程序"
                  variant="secondary"
                  @click="selectExecutable"
                />
              </div>
            </label>
            <label class="amane-form-row"
              ><span>服务地址</span
              ><UiInput
                v-model="form.baseUrl"
                placeholder="http://127.0.0.1:18180"
                required
            /></label>
            <label v-if="form.mode === 'managed'" class="amane-form-row">
              <span>片库数据目录</span>
              <div class="amane-form-control">
                <UiInput v-model="form.dataDirectory" required /><UiIconButton
                  icon="folder"
                  label="选择目录"
                  variant="secondary"
                  @click="selectDataDirectory"
                />
              </div>
            </label>
            <label v-if="form.mode === 'external'" class="amane-form-row"
              ><span>API Token</span
              ><UiInput
                v-model="token"
                type="password"
                autocomplete="off"
                :placeholder="
                  status?.settings.tokenConfigured
                    ? '已保存，留空保留原密钥'
                    : '输入已有服务的 API Token'
                "
            /></label>
          </div>
          <div class="amane-form-footer">
            <UiButton
              v-if="status?.owned"
              icon="stop"
              label="停止后台"
              :disabled="busy"
              @click="stop"
            />
            <UiButton
              type="submit"
              variant="primary"
              :label="busy ? '处理中…' : '保存并连接'"
              :disabled="busy"
            />
          </div>
        </form>
        <p v-if="status?.error" class="amane-task-error">{{ status.error }}</p>
        <p class="amane-muted">
          数据目录保存独立片库。扫描保留视频原位置；退出影盒时只关闭由影盒启动的后台。
        </p>
        <p v-if="status?.settings.devSource" class="amane-muted">
          开发模式：正在运行项目源码 packages/amane/upstream，修改 Python
          后点「保存并连接」即可生效；设置 YINGBOX_AMANE_FORCE_EXE=1
          可切回打包后台。
        </p>
      </section>

      <section
        v-else-if="activeSection === 'phone'"
        class="amane-settings-page"
      >
        <h2>手机接入</h2>
        <p class="amane-muted">
          生成同一 Wi-Fi 下可用的影盒链接。首次在手机浏览器打开后即可自动绑定
          Amane 片库。
        </p>
        <div class="amane-form-group">
          <div class="amane-form-row">
            <span>手机接入链接</span>
            <UiButton
              :icon="phoneLinkReady ? 'check' : 'copy'"
              :label="phoneLinkReady ? '链接已复制' : '复制链接'"
              :disabled="busy || !phoneToken"
              @click="copyPhoneLink"
            />
          </div>
        </div>
        <p v-if="!phoneToken" class="amane-muted">
          Amane 后台运行后即可生成链接。
        </p>
      </section>

      <ConfigSettings
        v-if="isWeb || status?.state === 'running'"
        v-show="isConfigSection"
        ref="configSettings"
        integrated
        :initial-section="activeConfigSection"
        @sections="configSections = $event"
      />
      <p v-else-if="isConfigSection" class="amane-muted" role="status">
        请先在“连接与存储”中启动 Amane 后台，再调整配置。
      </p>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import './amane.css'
import {
  UiButton,
  UiIconButton,
  UiInput,
  UiNavItem,
  UiSelect,
} from '@/components/ui'
import ConfigSettings from './ConfigSettings.vue'
import { message } from 'ant-design-vue'
import type { AmaneSettings, AmaneStatus } from '../../../../shared/amane'
import { getSetting } from '@/features/settings/use-setting'
import { sectionLabel } from './config-schema'

const props = defineProps<{
  status: AmaneStatus | null
  initialSection?: string
}>()
// Web/PWA(无 Electron 桥):连接与手机接入在桌面端管理;此处只保留经 HTTP 的模型/刮削配置。
const isWeb = !window.api?.amane
const configSettings = ref<InstanceType<typeof ConfigSettings> | null>(null)
const emit = defineEmits<{ changed: [status: AmaneStatus] }>()
const configSections = ref<string[]>([])
const activeSection = ref(
  isWeb
    ? props.initialSection &&
      !['connection', 'phone'].includes(props.initialSection)
      ? props.initialSection
      : ''
    : props.initialSection || 'connection'
)
const isConfigSection = computed(
  () => !['connection', 'phone'].includes(activeSection.value)
)
const activeConfigSection = computed(() =>
  isConfigSection.value
    ? activeSection.value
    : configSections.value[0] || 'scraping'
)
watch(
  () => props.initialSection,
  value => {
    if (value) activeSection.value = value
  }
)
watch(configSections, sections => {
  if (
    isConfigSection.value &&
    !sections.includes(activeSection.value) &&
    sections.length
  )
    activeSection.value = sections[0]
})
const form = reactive<Omit<AmaneSettings, 'tokenConfigured'>>({
  mode: 'managed',
  executablePath: '',
  baseUrl: 'http://127.0.0.1:18180',
  dataDirectory: '',
})
const token = ref(''),
  busy = ref(false),
  error = ref(''),
  initialized = ref(false)
const connectionDirty = computed(() =>
  Boolean(
    initialized.value &&
    props.status &&
    (JSON.stringify({
      mode: form.mode,
      executablePath: form.executablePath,
      baseUrl: form.baseUrl,
      dataDirectory: form.dataDirectory,
    }) !==
      JSON.stringify({
        mode: props.status.settings.mode,
        executablePath: props.status.settings.executablePath,
        baseUrl: props.status.settings.baseUrl,
        dataDirectory: props.status.settings.dataDirectory,
      }) ||
      token.value.trim())
  )
)

function canLeave(): boolean {
  if (configSettings.value && !configSettings.value.canLeave()) return false
  return (
    !connectionDirty.value ||
    window.confirm('连接设置尚未保存，确定放弃更改并离开吗？')
  )
}

defineExpose({ canLeave })

function selectSection(section: string): void {
  activeSection.value = section
}

watch(
  () => props.status,
  status => {
    if (status && !initialized.value) {
      Object.assign(form, status.settings)
      initialized.value = true
    }
  },
  { immediate: true }
)

async function act(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

async function selectExecutable(): Promise<void> {
  const path = await window.api.amane.selectExecutable()
  if (path) form.executablePath = path
}

async function selectDataDirectory(): Promise<void> {
  const path = await window.api.dialog.selectDirectory()
  if (path) form.dataDirectory = path
}

async function saveConnection(): Promise<void> {
  if (configSettings.value && !configSettings.value.canLeave()) return
  await act(async () => {
    emit('changed', await window.api.amane.stop())
    const changes = {
      mode: form.mode,
      executablePath: form.executablePath.trim(),
      baseUrl: form.baseUrl.trim(),
      dataDirectory: form.dataDirectory.trim(),
      ...(token.value.trim() ? { token: token.value.trim() } : {}),
    }
    await window.api.amane.configure(changes)
    token.value = ''
    const next = await window.api.amane.start()
    emit('changed', next)
    if (next.state !== 'running')
      throw new Error(next.error || 'Amane 连接失败')
    message.success('Amane 已连接')
  })
}

async function stop(): Promise<void> {
  if (canLeave())
    await act(async () => {
      emit('changed', await window.api.amane.stop())
    })
}

/* 手机接入:复制 ?amane=<token>&key=<backendKey> 链接(走 vite 同源代理)。 */
const phoneToken = ref(''),
  phoneLinkReady = ref(false)
watch(
  () => props.status,
  () => {
    if (isWeb) return
    void window.api.amane.connection().then(info => {
      phoneToken.value = info.token
    })
  },
  { immediate: true }
)

async function copyPhoneLink(): Promise<void> {
  try {
    const ips = await window.api.app.networkIps()
    const lanHost = ips[0] || new URL(window.location.href).hostname
    const key = getSetting('backend.apiKey')
    const query = new URLSearchParams({
      amane: phoneToken.value,
      ...(key ? { key } : {}),
    })
    const link = `http://${lanHost}:4173/?${query.toString()}`
    await navigator.clipboard.writeText(link)
    phoneLinkReady.value = true
    message.success('手机接入链接已复制，请在手机浏览器打开一次')
    setTimeout(() => {
      phoneLinkReady.value = false
    }, 2500)
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>
