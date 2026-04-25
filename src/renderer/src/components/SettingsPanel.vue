<template>
  <!-- 遮罩层 -->
  <Transition name="settings-fade">
    <div
      v-if="visible"
      class="fixed inset-0 z-[900] bg-black/40 backdrop-blur-sm"
      @click="$emit('close')"
    />
  </Transition>

  <!-- 设置面板 -->
  <Transition name="settings-slide">
    <div
      v-if="visible"
      class="fixed inset-0 z-[901] flex items-center justify-center pointer-events-none"
    >
    <div
      class="pointer-events-auto relative flex flex-col rounded-2xl"
      style="width: min(60vw, 92vw); max-height: 85vh; background: rgba(10,12,18,0.95); backdrop-filter: blur(24px); border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 24px 64px rgba(0,0,0,0.7);"
      @click.stop
    >
      <!-- 头部 -->
      <div class="flex items-center justify-between px-5 py-4  flex-shrink-0">
        <div class="flex items-center gap-2.5">
          <span class="text-sm font-semibold text-white/90 tracking-wide">设置</span>
        </div>
        <button
          @click="$emit('close')"
          class="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-300 hover:bg-white/10 transition-all"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- 设置内容（可滚动） -->
      <div class="flex-1 overflow-y-auto py-3 px-4 space-y-2 scrollbar-thin">

        <!-- 分区：图片质量（合并海报/背景/演员） -->
        <SettingsSection title="图片质量" icon="image">
          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-gray-400 w-14 flex-shrink-0">海报</span>
              <div class="flex gap-1 flex-1">
                <button v-for="opt in imageSizeOptions" :key="opt.value"
                  class="flex-1 py-1 text-[10px] rounded transition-all"
                  :class="posterSize === opt.value ? 'bg-blue-600/40 border border-blue-500/50 text-blue-300 font-semibold' : 'bg-white/5 border border-transparent text-gray-400 hover:bg-white/10'"
                  @click="posterSize = opt.value"
                >{{ opt.short }}</button>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-gray-400 w-14 flex-shrink-0">背景图</span>
              <div class="flex gap-1 flex-1">
                <button v-for="opt in imageSizeOptions" :key="opt.value"
                  class="flex-1 py-1 text-[10px] rounded transition-all"
                  :class="backdropSize === opt.value ? 'bg-blue-600/40 border border-blue-500/50 text-blue-300 font-semibold' : 'bg-white/5 border border-transparent text-gray-400 hover:bg-white/10'"
                  @click="backdropSize = opt.value"
                >{{ opt.short }}</button>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-gray-400 w-14 flex-shrink-0">演员</span>
              <div class="flex gap-1 flex-1">
                <button v-for="opt in imageSizeOptions" :key="opt.value"
                  class="flex-1 py-1 text-[10px] rounded transition-all"
                  :class="actorSize === opt.value ? 'bg-blue-600/40 border border-blue-500/50 text-blue-300 font-semibold' : 'bg-white/5 border border-transparent text-gray-400 hover:bg-white/10'"
                  @click="actorSize = opt.value"
                >{{ opt.short }}</button>
              </div>
            </div>
          </div>
        </SettingsSection>

        <!-- 分区：元数据语言 -->
        <SettingsSection title="元数据语言" icon="globe">
          <p class="text-[11px] text-gray-500 mb-2">刮削时从 TMDB 获取的标题、简介、演员等信息的语言</p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="opt in metadataLanguageOptions"
              :key="opt.value"
              class="px-3 py-1 text-[10px] rounded-lg transition-all"
              :class="metadataLanguage === opt.value ? 'bg-blue-600/40 border border-blue-500/50 text-blue-300 font-semibold' : 'bg-white/5 border border-transparent text-gray-400 hover:bg-white/10'"
              @click="metadataLanguage = opt.value"
            >{{ opt.label }}</button>
          </div>
        </SettingsSection>

        <!-- 分区：播放器 -->
        <SettingsSection title="播放器" icon="play">
          <div class="space-y-1">
            <div
              v-for="opt in playerOptions"
              :key="opt.value"
              class="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all"
              :class="videoPlayer === opt.value
                ? 'bg-blue-600/25 border border-blue-500/40'
                : 'bg-white/5 border border-transparent hover:bg-white/8'"
              @click="videoPlayer = opt.value"
            >
              <div
                class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                :class="videoPlayer === opt.value ? 'border-blue-400 bg-blue-400' : 'border-gray-600'"
              >
                <div v-if="videoPlayer === opt.value" class="w-1.5 h-1.5 rounded-full bg-white" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium text-white/90">{{ opt.label }}</div>
                <div class="text-[10px] text-gray-500">{{ opt.desc }}</div>
              </div>
            </div>
          </div>
        </SettingsSection>

        <!-- 分区：刮削服务 -->
        <SettingsSection title="刮削服务" icon="database">
          <p class="text-[11px] text-gray-500 mb-2">选择元数据刮削服务提供者</p>

          <!-- 服务选择 -->
          <div class="space-y-1 mb-3">
            <div
              v-for="opt in providerOptions"
              :key="opt.value"
              class="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all"
              :class="currentProvider === opt.value
                ? 'bg-blue-600/25 border border-blue-500/40'
                : 'bg-white/5 border border-transparent hover:bg-white/8'"
              @click="currentProvider = opt.value"
            >
              <div
                class="w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                :class="currentProvider === opt.value ? 'border-blue-400 bg-blue-400' : 'border-gray-600'"
              >
                <div v-if="currentProvider === opt.value" class="w-1.5 h-1.5 rounded-full bg-white" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium text-white/90">{{ opt.label }}</div>
                <div class="text-[10px] text-gray-500">{{ opt.desc }}</div>
              </div>
            </div>
          </div>

          <!-- TMDB 配置 -->
          <div v-if="currentProvider === 'tmdb'" class="space-y-2">
            <p class="text-[11px] text-gray-400">TMDB Access Token</p>
            <textarea
              v-model="tmdbAccessToken"
              placeholder="输入 TMDB API Read Access Token"
              rows="3"
              class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white/80 placeholder-gray-600 resize-none focus:outline-none focus:border-blue-500/50 transition-colors"
            />
            <p class="text-[10px] text-gray-600">
              前往
              <a href="https://www.themoviedb.org/settings/api" target="_blank" class="text-blue-400 hover:underline">TMDB API 设置</a>
              获取 Read Access Token
            </p>
          </div>

          <!-- MetaTube 配置 -->
          <div v-if="currentProvider === 'metatube'" class="space-y-2">
            <div>
              <p class="text-[11px] text-gray-400 mb-1">服务器地址</p>
              <input
                v-model="metaServerUrl"
                type="text"
                placeholder="例如：http://localhost:8080"
                class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <div>
              <p class="text-[11px] text-gray-400 mb-1">Bearer Token（可选）</p>
              <input
                v-model="metaToken"
                type="password"
                placeholder="留空则不鉴权"
                class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <div class="flex items-center gap-2">
              <button
                @click="handleTestMetatube"
                :disabled="!metaServerUrl || metaTestStatus === 'testing'"
                class="px-3 py-1 text-xs rounded-md transition-all"
                :class="metaTestStatus === 'ok' ? 'bg-green-600/30 border border-green-500/40 text-green-400'
                  : metaTestStatus === 'fail' ? 'bg-red-600/30 border border-red-500/40 text-red-400'
                  : 'bg-white/8 border border-white/10 text-gray-300 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed'"
              >
                {{ metaTestStatus === 'testing' ? '测试中...' : metaTestStatus === 'ok' ? '✓ 连接成功' : metaTestStatus === 'fail' ? '✗ 连接失败' : '测试连接' }}
              </button>
            </div>
            <p class="text-[10px] text-gray-600">
              部署教程：<a href="https://metatube-community.github.io/wiki/server-deployment/" target="_blank" class="text-blue-400 hover:underline">metatube-server 部署文档</a>
            </p>
          </div>

          <!-- JavBus Go 后端配置 -->
          <div v-if="currentProvider === 'javbus'" class="space-y-2">
            <div>
              <p class="text-[11px] text-gray-400 mb-1">Go 后端地址</p>
              <input
                v-model="goBackendUrl"
                type="text"
                placeholder="例如：http://localhost:31471"
                class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <div class="flex items-center gap-2">
              <button
                @click="handleTestGoBackend"
                :disabled="!goBackendUrl || goTestStatus === 'testing'"
                class="px-3 py-1 text-xs rounded-md transition-all"
                :class="goTestStatus === 'ok' ? 'bg-green-600/30 border border-green-500/40 text-green-400'
                  : goTestStatus === 'fail' ? 'bg-red-600/30 border border-red-500/40 text-red-400'
                  : 'bg-white/8 border border-white/10 text-gray-300 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed'"
              >{{ goTestStatus === 'testing' ? '测试中...' : goTestStatus === 'ok' ? '✓ 连接成功' : goTestStatus === 'fail' ? '✗ 连接失败' : '测试连接' }}</button>
            </div>
            <p class="text-[10px] text-gray-600">需先在 <code class="bg-white/5 px-1 rounded">packages/services/</code> 目录下启动 Go 服务</p>
          </div>

          <!-- 自定义服务配置 -->
          <div v-if="currentProvider === 'custom'" class="space-y-2">
            <div>
              <p class="text-[11px] text-gray-400 mb-1">服务名称</p>
              <input
                v-model="customProviderName"
                type="text"
                placeholder="例如：我的刮削服务"
                class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <div>
              <p class="text-[11px] text-gray-400 mb-1">API 基础 URL</p>
              <input
                v-model="customBaseUrl"
                type="text"
                placeholder="例如：https://api.example.com"
                class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <div>
              <p class="text-[11px] text-gray-400 mb-1">API Key</p>
              <input
                v-model="customApiKey"
                type="password"
                placeholder="输入 API Key"
                class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
            </div>
            <p class="text-[10px] text-gray-600">自定义服务需实现与 TMDB 兼容的接口格式</p>
          </div>
        </SettingsSection>

      </div>

      <!-- 底部版本信息 -->
      <div class="flex-shrink-0 px-5 py-3 border-t border-white/8 flex items-center justify-between">
        <p class="text-[10px] text-gray-600">PosterScraper · 设置</p>
        <button
          @click="resetProviderConfig"
          class="text-[10px] text-gray-600 hover:text-red-400 transition-colors px-2 py-0.5 rounded hover:bg-white/5"
        >重置刮削配置</button>
      </div>
    </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import SettingsSection from '@/components/SettingsSection.vue'
import {
  getScrapeProviderConfig,
  saveScrapeProviderConfig,
  type ScrapeProviderType,
} from '@/stores/scrape-provider-store'
import { testMetatubeConnection } from '@/api/metatube'
import { backend } from '@/api/backend'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

const imageSizeOptions = [
  { value: 'w342', short: '小', label: '小 (w342)' },
  { value: 'w780', short: '中', label: '中 (w780)' },
  { value: 'original', short: '原图', label: '原图' },
]

const posterSize = ref(localStorage.getItem('imageDownloadSize_poster') || 'original')
const backdropSize = ref(localStorage.getItem('imageDownloadSize_backdrop') || 'original')
const actorSize = ref(localStorage.getItem('imageDownloadSize_actor') || 'original')

watch(posterSize, (val) => localStorage.setItem('imageDownloadSize_poster', val), { immediate: true })
watch(backdropSize, (val) => localStorage.setItem('imageDownloadSize_backdrop', val), { immediate: true })
watch(actorSize, (val) => localStorage.setItem('imageDownloadSize_actor', val), { immediate: true })

const metadataLanguageOptions = [
  { value: 'zh-CN', label: '中文简体' },
  { value: 'zh-TW', label: '中文繁體' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
]
const metadataLanguage = ref(localStorage.getItem('metadataLanguage') || 'zh-CN')
watch(metadataLanguage, (val) => localStorage.setItem('metadataLanguage', val), { immediate: true })

// 播放器
const playerOptions = [
  { value: 'builtin', label: '内置播放器', desc: 'HTML5 视频，秒开，支持 MP4 等常见格式' },
  { value: 'system',  label: '系统默认',   desc: '调用系统关联的播放器（如 PotPlayer）' },
]
const videoPlayer = ref(localStorage.getItem('videoPlayer') || 'builtin')
watch(() => videoPlayer.value, (val) => localStorage.setItem('videoPlayer', val))

// 刮削服务
const providerOptions: { value: ScrapeProviderType; label: string; desc: string }[] = [
  { value: 'tmdb', label: 'TMDB', desc: 'The Movie Database，全球最大的电影数据库' },
  { value: 'metatube', label: 'MetaTube', desc: '适合 JAV，需自行部署 metatube-server' },
  { value: 'javbus', label: 'JavBus Go 服务', desc: '本地 Go 后端，从 JavBus 刮削 JAV 元数据并下载图片' },
  { value: 'custom', label: '自定义服务', desc: '接入自己的刮削 API' },
]

const _config = getScrapeProviderConfig()
const currentProvider = ref<ScrapeProviderType>(_config.provider)
const tmdbAccessToken = ref(_config.tmdbAccessToken)
const customProviderName = ref(_config.customProviderName)
const customBaseUrl = ref(_config.customBaseUrl)
const customApiKey = ref(_config.customApiKey)
const metaServerUrl = ref(_config.metaServerUrl)
const metaToken = ref(_config.metaToken)
const goBackendUrl = ref(_config.goBackendUrl || 'http://localhost:31471')
const metaTestStatus = ref<'idle' | 'testing' | 'ok' | 'fail'>('idle')
const goTestStatus = ref<'idle' | 'testing' | 'ok' | 'fail'>('idle')

const loadConfig = () => {
  const c = getScrapeProviderConfig()
  currentProvider.value = c.provider
  tmdbAccessToken.value = c.tmdbAccessToken
  customProviderName.value = c.customProviderName
  customBaseUrl.value = c.customBaseUrl
  customApiKey.value = c.customApiKey
  metaServerUrl.value = c.metaServerUrl
  metaToken.value = c.metaToken
  goBackendUrl.value = c.goBackendUrl || 'http://localhost:31471'
}

watch(currentProvider, (val) => saveScrapeProviderConfig({ provider: val }))
watch(tmdbAccessToken, (val) => saveScrapeProviderConfig({ tmdbAccessToken: val }))
watch(customProviderName, (val) => saveScrapeProviderConfig({ customProviderName: val }))
watch(customBaseUrl, (val) => saveScrapeProviderConfig({ customBaseUrl: val }))
watch(customApiKey, (val) => saveScrapeProviderConfig({ customApiKey: val }))
watch(metaServerUrl, (val) => { saveScrapeProviderConfig({ metaServerUrl: val }); metaTestStatus.value = 'idle' })
watch(metaToken, (val) => saveScrapeProviderConfig({ metaToken: val }))
watch(goBackendUrl, (val) => { saveScrapeProviderConfig({ goBackendUrl: val }); goTestStatus.value = 'idle' })
watch(() => props.visible, (v) => { if (v) loadConfig() })

const resetProviderConfig = (): void => {
  localStorage.removeItem('scrapeProviderConfig')
  loadConfig()
  metaTestStatus.value = 'idle'
  goTestStatus.value = 'idle'
}

const handleTestMetatube = async (): Promise<void> => {
  console.log('[MetaTube] 开始测试, url:', metaServerUrl.value, 'fetch:', typeof (window.api?.http as any)?.fetch)
  metaTestStatus.value = 'testing'
  const ok = await testMetatubeConnection(metaServerUrl.value, metaToken.value)
  console.log('[MetaTube] 测试结果:', ok)
  metaTestStatus.value = ok ? 'ok' : 'fail'
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
  transition: opacity 0.2s ease;
}
.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}

.settings-slide-enter-active,
.settings-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.settings-slide-enter-from,
.settings-slide-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

.scrollbar-thin {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  transition: scrollbar-color 0.2s;
}
.scrollbar-thin:hover {
  scrollbar-color: rgba(255,255,255,0.2) transparent;
}
.scrollbar-thin::-webkit-scrollbar {
  width: 4px;
}
.scrollbar-thin::-webkit-scrollbar-track {
  background: transparent;
}
.scrollbar-thin::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 2px;
  transition: background 0.2s;
}
.scrollbar-thin:hover::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.2);
}
</style>
