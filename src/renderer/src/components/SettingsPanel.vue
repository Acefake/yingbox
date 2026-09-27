<template>
  <!-- 遮罩层 -->
  <Transition name="settings-fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-[2100] bg-black/40 backdrop-blur-sm"
      @click="$emit('close')"
    />
  </Transition>

  <!-- 设置面板 -->
  <Transition name="settings-slide">
    <div
      v-if="visible"
      class="fixed inset-y-0 right-0 z-[2101] pointer-events-none"
    >
      <div
        class="settings-drawer pointer-events-auto relative flex h-full flex-col"
        @click.stop
      >
        <!-- 头部 -->
        <div class="settings-header flex items-center justify-between px-6 py-5 flex-shrink-0">
          <div>
            <h1 class="yb-page-title settings-drawer-title">设置</h1>
            <p class="yb-section-subtitle">偏好与刮削服务</p>
          </div>
          <button
            aria-label="关闭设置"
            class="settings-close-btn"
            @click="$emit('close')"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.75"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <!-- 设置内容（可滚动） -->
        <div class="flex-1 overflow-y-auto px-5 py-4 custom-scrollbar settings-body">
          <!-- 分区：图片质量（合并海报/背景/演员） -->
          <SettingsSection title="图片质量" icon="image">
            <div class="space-y-3">
              <div class="settings-row">
                <span class="settings-row-label">海报</span>
                <div class="yb-seg-group flex-1">
                  <button
                    v-for="opt in imageSizeOptions"
                    :key="opt.value"
                    class="yb-seg"
                    :class="{ 'is-active': posterSize === opt.value }"
                    @click="posterSize = opt.value"
                  >
                    {{ opt.short }}
                  </button>
                </div>
              </div>
              <div class="settings-row">
                <span class="settings-row-label">背景图</span>
                <div class="yb-seg-group flex-1">
                  <button
                    v-for="opt in imageSizeOptions"
                    :key="opt.value"
                    class="yb-seg"
                    :class="{ 'is-active': backdropSize === opt.value }"
                    @click="backdropSize = opt.value"
                  >
                    {{ opt.short }}
                  </button>
                </div>
              </div>
              <div class="settings-row">
                <span class="settings-row-label">演员</span>
                <div class="yb-seg-group flex-1">
                  <button
                    v-for="opt in imageSizeOptions"
                    :key="opt.value"
                    class="yb-seg"
                    :class="{ 'is-active': actorSize === opt.value }"
                    @click="actorSize = opt.value"
                  >
                    {{ opt.short }}
                  </button>
                </div>
              </div>
            </div>
          </SettingsSection>

          <!-- 分区：元数据语言 -->
          <SettingsSection title="元数据语言" icon="globe">
            <p class="text-[11px] yb-dim mb-2">
              刮削时从 TMDB 获取的标题、简介、演员等信息的语言
            </p>
            <div class="yb-seg-group settings-lang-group">
              <button
                v-for="opt in metadataLanguageOptions"
                :key="opt.value"
                class="yb-seg"
                :class="{ 'is-active': metadataLanguage === opt.value }"
                @click="metadataLanguage = opt.value"
              >
                {{ opt.label }}
              </button>
            </div>
          </SettingsSection>

          <!-- 分区：播放器 -->
          <SettingsSection title="播放器" icon="play">
            <div class="yb-info-callout">
              <div class="yb-info-callout-title">统一内置播放器</div>
              <div class="yb-info-callout-body">首页、本地影视和 AV 资源共用同一播放器，使用统一的基础播放控制。</div>
            </div>
          </SettingsSection>

          <!-- 分区：刮削服务 -->
          <SettingsSection title="刮削服务" icon="database">
            <p class="text-[11px] yb-dim mb-2">
              选择元数据刮削服务提供者
            </p>

            <!-- 服务选择 -->
            <div class="space-y-1 mb-3">
              <div
                v-for="opt in filteredProviderOptions"
                :key="opt.value"
                class="yb-choice-card"
                :class="{ 'is-active': currentProvider === opt.value }"
                @click="currentProvider = opt.value"
              >
                <div
                  class="yb-radio"
                  :class="{ 'is-active': currentProvider === opt.value }"
                >
                  <div
                    v-if="currentProvider === opt.value"
                    class="yb-radio-dot"
                  />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-medium" style="color: var(--text-primary)">
                    {{ opt.label }}
                  </div>
                  <div class="text-[10px] yb-dim">{{ opt.desc }}</div>
                </div>
              </div>
            </div>

            <!-- TMDB 配置 -->
            <div v-if="currentProvider === 'tmdb'" class="space-y-2">
              <p class="text-[11px] yb-muted">TMDB Access Token</p>
              <textarea
                v-model="tmdbAccessToken"
                placeholder="输入 TMDB API Read Access Token（必填，无内置默认值）"
                rows="3"
                class="yb-field resize-none"
              />
              <p class="text-[10px] yb-dim">
                前往
                <a
                  href="https://www.themoviedb.org/settings/api"
                  target="_blank"
                  class="yb-link"
                  >TMDB API 设置</a
                >
                获取 Read Access Token
              </p>
              <p v-if="!tmdbAccessToken" class="text-[10px] yb-status-fail">
                尚未配置 Token，TMDB 搜索与刮削不可用
              </p>
            </div>

            <!-- JavBus Go 后端配置 -->
            <div v-if="currentProvider === 'javbus'" class="space-y-2">
              <div>
                <p class="text-[11px] yb-muted mb-1">Go 后端地址</p>
                <input
                  v-model="goBackendUrl"
                  type="text"
                  placeholder="例如：http://localhost:31471"
                  class="yb-field"
                />
              </div>
              <div>
                <p class="text-[11px] yb-muted mb-1">访问密钥（可选）</p>
                <input
                  v-model="goBackendApiKey"
                  type="password"
                  autocomplete="off"
                  placeholder="后端暴露到局域网/NAS 时填写"
                  class="yb-field"
                />
                <p class="text-[10px] yb-dim mt-1">
                  仅当后端设置了
                  <code class="yb-chip" style="padding: 0 4px; border-radius: 4px">YINGBOX_API_KEY</code>
                  时需要；仅本机使用可留空
                </p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  :disabled="!goBackendUrl || goTestStatus === 'testing'"
                  class="px-3 py-1 text-xs rounded-md transition-all yb-btn-soft"
                  :class="
                    goTestStatus === 'ok'
                      ? 'yb-status-ok'
                      : goTestStatus === 'fail'
                        ? 'yb-status-fail'
                        : ''
                  "
                  @click="handleTestGoBackend"
                >
                  {{
                    goTestStatus === 'testing'
                      ? '测试中...'
                      : goTestStatus === 'ok'
                        ? '✓ 连接成功'
                        : goTestStatus === 'fail'
                          ? '✗ 连接失败'
                          : '测试连接'
                  }}
                </button>
              </div>
              <p class="text-[10px] yb-dim">
                需先在
                <code class="yb-chip" style="padding: 0 4px; border-radius: 4px">packages/services/</code>
                目录下启动 Go 服务
              </p>
            </div>

            <!-- 自定义服务配置 -->
            <div v-if="currentProvider === 'custom'" class="space-y-2">
              <div>
                <p class="text-[11px] yb-muted mb-1">服务名称</p>
                <input
                  v-model="customProviderName"
                  type="text"
                  placeholder="例如：我的刮削服务"
                  class="yb-field"
                />
              </div>
              <div>
                <p class="text-[11px] yb-muted mb-1">API 基础 URL</p>
                <input
                  v-model="customBaseUrl"
                  type="text"
                  placeholder="例如：https://api.example.com"
                  class="yb-field"
                />
              </div>
              <div>
                <p class="text-[11px] yb-muted mb-1">API Key</p>
                <input
                  v-model="customApiKey"
                  type="password"
                  placeholder="输入 API Key"
                  class="yb-field"
                />
              </div>
              <p class="text-[10px] yb-dim">
                自定义服务需实现与 TMDB 兼容的接口格式
              </p>
            </div>
          </SettingsSection>

          <SettingsSection title="软件更新" icon="download">
            <div class="space-y-2">
              <div class="flex items-center justify-between gap-3 px-3 py-2 rounded-lg settings-update-card">
                <div class="min-w-0">
                  <div class="text-xs font-medium" style="color: var(--text-primary)">{{ updateTitle }}</div>
                  <div class="text-[10px] yb-dim mt-0.5">{{ updateMessage }}</div>
                </div>
                <button
                  v-if="updateAction"
                  :disabled="updateBusy"
                  class="yb-btn-soft whitespace-nowrap"
                  @click="handleUpdateAction"
                >
                  {{ updateAction }}
                </button>
              </div>
              <div v-if="updateStatus === 'downloading'" class="h-1.5 rounded-full settings-progress-track overflow-hidden">
                <div class="h-full rounded-full settings-progress-bar transition-all" :style="{ width: `${updateProgress}%` }"></div>
              </div>
            </div>
          </SettingsSection>
        </div>

        <!-- 底部版本信息 -->
        <div class="settings-footer">
          <p class="settings-footer-meta">影盒 · 设置</p>
          <button type="button" class="settings-reset-btn" @click="resetProviderConfig">
            重置刮削配置
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import SettingsSection from '@/components/SettingsSection.vue'
import {
  type ScrapeProviderType,
  getScrapeProviderConfig,
  saveScrapeProviderConfig,
} from '@/stores/scrape-provider-store'
import { backend } from '@/api/backend'

const props = defineProps<{ visible: boolean }>()
defineEmits<{ close: [] }>()

const imageSizeOptions = [
  { value: 'w342', short: '小', label: '小 (w342)' },
  { value: 'w780', short: '中', label: '中 (w780)' },
  { value: 'original', short: '原图', label: '原图' },
]

const posterSize = ref(
  localStorage.getItem('imageDownloadSize_poster') || 'original'
)
const backdropSize = ref(
  localStorage.getItem('imageDownloadSize_backdrop') || 'original'
)
const actorSize = ref(
  localStorage.getItem('imageDownloadSize_actor') || 'original'
)

watch(
  posterSize,
  val => localStorage.setItem('imageDownloadSize_poster', val),
  { immediate: true }
)
watch(
  backdropSize,
  val => localStorage.setItem('imageDownloadSize_backdrop', val),
  { immediate: true }
)
watch(actorSize, val => localStorage.setItem('imageDownloadSize_actor', val), {
  immediate: true,
})

const metadataLanguageOptions = [
  { value: 'zh-CN', label: '中文简体' },
  { value: 'zh-TW', label: '中文繁體' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
]
const metadataLanguage = ref(
  localStorage.getItem('metadataLanguage') || 'zh-CN'
)
watch(metadataLanguage, val => localStorage.setItem('metadataLanguage', val), {
  immediate: true,
})

// 刮削服务
const providerOptions: {
  value: ScrapeProviderType
  label: string
  desc: string
  adult?: boolean
}[] = [
  {
    value: 'tmdb',
    label: 'TMDB',
    desc: 'The Movie Database，全球最大的电影数据库',
  },
  {
    value: 'javbus',
    label: 'JavBus Go 服务',
    desc: '本地 Go 后端，从 JavBus 刮削 JAV 元数据并下载图片',
    adult: true,
  },
  { value: 'custom', label: '自定义服务', desc: '接入自己的刮削 API' },
]

// 成人模式状态
const adultMode = ref(localStorage.getItem('adultMode') === '1')

// 根据成人模式过滤服务选项
const filteredProviderOptions = computed(() =>
  providerOptions.filter(opt => !opt.adult || adultMode.value)
)

// 成人模式关闭时，如果当前选中的是成人服务，自动切换到 TMDB
watch(adultMode, isAdult => {
  if (!isAdult && providerOptions.find(opt => opt.value === currentProvider.value)?.adult) {
    currentProvider.value = 'tmdb'
  }
})

const _config = getScrapeProviderConfig()
const currentProvider = ref<ScrapeProviderType>(_config.provider)
const tmdbAccessToken = ref(_config.tmdbAccessToken)
const customProviderName = ref(_config.customProviderName)
const customBaseUrl = ref(_config.customBaseUrl)
const customApiKey = ref(_config.customApiKey)
const goBackendUrl = ref(_config.goBackendUrl || 'http://localhost:31471')
const goBackendApiKey = ref(_config.goBackendApiKey || '')
const goTestStatus = ref<'idle' | 'testing' | 'ok' | 'fail'>('idle')

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

const updateStatus = ref<UpdateStatus>('idle')
const updateBusy = ref(false)
const updateProgress = ref(0)
const updateError = ref('')
const updateVersion = ref('')

const updateTitle = computed(() => {
  if (updateStatus.value === 'checking') return '正在检查更新'
  if (updateStatus.value === 'available') return `发现新版本 ${updateVersion.value || ''}`.trim()
  if (updateStatus.value === 'not-available') return '当前已是最新版本'
  if (updateStatus.value === 'downloading') return '正在下载更新'
  if (updateStatus.value === 'downloaded') return '更新已下载'
  if (updateStatus.value === 'error') return '更新检查失败'
  return '检查软件更新'
})

const updateMessage = computed(() => {
  if (updateStatus.value === 'checking') return '正在连接 GitHub Releases...'
  if (updateStatus.value === 'available') return '可以下载新版本，下载完成后可重启安装'
  if (updateStatus.value === 'not-available') return '你的影盒版本已经是最新'
  if (updateStatus.value === 'downloading') return `下载进度 ${updateProgress.value.toFixed(1)}%`
  if (updateStatus.value === 'downloaded') return '点击重启安装，应用会自动关闭并完成更新'
  if (updateStatus.value === 'error') return updateError.value || '请稍后重试'
  return '从 GitHub Release 检查是否有新版本'
})

const updateAction = computed(() => {
  if (updateStatus.value === 'available') return '下载更新'
  if (updateStatus.value === 'downloaded') return '重启安装'
  if (updateStatus.value === 'checking' || updateStatus.value === 'downloading') return ''
  return '检查更新'
})

const handleUpdateStatus = (status: any) => {
  updateStatus.value = status.status || 'idle'
  updateBusy.value = status.status === 'checking' || status.status === 'downloading'
  if (status.info?.version) updateVersion.value = status.info.version
  if (status.progress?.percent != null) updateProgress.value = status.progress.percent
  if (status.error) updateError.value = status.error
}

const handleUpdateAction = async () => {
  updateBusy.value = true
  updateError.value = ''
  try {
    if (updateStatus.value === 'available') {
      await window.api.update.download()
      return
    }
    if (updateStatus.value === 'downloaded') {
      await window.api.update.install()
      return
    }
    updateStatus.value = 'checking'
    const result = await window.api.update.check()
    if (!result.success) {
      updateStatus.value = 'error'
      updateError.value = result.error || '检查更新失败'
    }
  } finally {
    if (updateStatus.value !== 'checking' && updateStatus.value !== 'downloading') {
      updateBusy.value = false
    }
  }
}

window.api?.update?.onStatus?.(handleUpdateStatus)
onBeforeUnmount(() => window.api?.update?.offStatus?.())

const loadConfig = () => {
  // 刷新成人模式状态
  adultMode.value = localStorage.getItem('adultMode') === '1'

  const c = getScrapeProviderConfig()
  currentProvider.value = c.provider
  tmdbAccessToken.value = c.tmdbAccessToken
  customProviderName.value = c.customProviderName
  customBaseUrl.value = c.customBaseUrl
  customApiKey.value = c.customApiKey
  goBackendUrl.value = c.goBackendUrl || 'http://localhost:31471'
  goBackendApiKey.value = c.goBackendApiKey || ''
}

watch(currentProvider, val => saveScrapeProviderConfig({ provider: val }))
watch(tmdbAccessToken, val =>
  saveScrapeProviderConfig({ tmdbAccessToken: val })
)
watch(customProviderName, val =>
  saveScrapeProviderConfig({ customProviderName: val })
)
watch(customBaseUrl, val => saveScrapeProviderConfig({ customBaseUrl: val }))
watch(customApiKey, val => saveScrapeProviderConfig({ customApiKey: val }))
watch(goBackendUrl, val => {
  saveScrapeProviderConfig({ goBackendUrl: val })
  goTestStatus.value = 'idle'
})
watch(goBackendApiKey, val => {
  saveScrapeProviderConfig({ goBackendApiKey: val })
  goTestStatus.value = 'idle'
})
watch(
  () => props.visible,
  v => {
    if (v) loadConfig()
  }
)

const resetProviderConfig = (): void => {
  localStorage.removeItem('scrapeProviderConfig')
  loadConfig()
  goTestStatus.value = 'idle'
}

const handleTestGoBackend = async (): Promise<void> => {
  goTestStatus.value = 'testing'
  const ok = await backend.testConnection()
  goTestStatus.value = ok ? 'ok' : 'fail'
}
</script>

<style scoped>
.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 0.3s var(--ease-out);
}
.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}

.settings-slide-enter-active,
.settings-slide-leave-active {
  transition: var(--transition-panel);
}
.settings-slide-enter-from,
.settings-slide-leave-to {
  transform: translateX(100%);
}

.settings-drawer {
  width: min(500px, calc(100vw - 48px));
  background: var(--bg-panel);
  color: var(--text-primary);
  border-left: 1px solid var(--separator);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(var(--blur-panel)) saturate(var(--saturate-vibrancy));
  -webkit-backdrop-filter: blur(var(--blur-panel)) saturate(var(--saturate-vibrancy));
}

@media (max-width: 768px) {
  .settings-drawer {
    width: 100vw;
    border-left: 0;
  }
}

.settings-header {
  border-bottom: 1px solid var(--separator);
}

.settings-drawer-title {
  font-size: var(--text-2xl);
  letter-spacing: -0.022em;
}

.settings-close-btn {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: var(--bg-fill-secondary);
  border: 0;
  cursor: pointer;
  transition: var(--transition-fast);
}
.settings-close-btn:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
}
.settings-close-btn:active { transform: scale(0.94); }

.settings-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-row-label {
  width: 52px;
  flex-shrink: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.settings-lang-group {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
}
.settings-lang-group .yb-seg {
  flex: 1 1 auto;
  min-width: 72px;
}

.settings-update-card {
  background: var(--bg-fill-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}
.settings-progress-track { background: var(--bg-fill-secondary); }
.settings-progress-bar { background: var(--accent); }

.settings-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 22px 18px;
  border-top: 1px solid var(--separator);
  background: color-mix(in srgb, var(--bg-panel) 88%, transparent);
}
.settings-footer-meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.settings-reset-btn {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 6px 10px;
  border-radius: var(--radius-md);
  transition: var(--transition-fast);
}
.settings-reset-btn:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}
.settings-reset-btn:active { transform: scale(0.97); }

@media (prefers-reduced-transparency: reduce) {
  .settings-drawer {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: var(--bg-elevated);
  }
}
@media (prefers-reduced-motion: reduce) {
  .settings-slide-enter-active,
  .settings-slide-leave-active {
    transition: opacity 0.2s ease;
  }
  .settings-slide-enter-from,
  .settings-slide-leave-to { transform: none; }
  .settings-close-btn:active,
  .settings-reset-btn:active { transform: none; }
}
</style>
