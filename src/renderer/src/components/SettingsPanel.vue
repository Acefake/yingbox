<template>
  <!-- 遮罩层 -->
  <Transition name="settings-fade">
    <div v-if="visible" class="settings-backdrop" @click="requestClose" />
  </Transition>

  <!-- 设置窗口（左侧导航 + 右侧内容） -->
  <Transition name="settings-pop">
    <div
      v-if="visible"
      class="settings-window"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      @click.stop
    >
      <div class="settings-frame">
        <DialogTitlebar :title="`设置 · ${currentSection.label}`" icon="settings" @close="requestClose" />
        <div class="settings-body flex min-h-0 min-w-0 flex-1">
        <!-- 左侧：搜索 + 分区导航 -->
        <aside class="settings-nav">
          <div class="settings-search">
            <AppIcon name="search" size="sm" />
            <input
              v-model="navQuery"
              placeholder="搜索设置"
              type="text"
              aria-label="搜索设置"
            />
          </div>
          <nav class="settings-nav-list" aria-label="设置分区">
            <button
              v-for="sec in visibleSections"
              :key="sec.id"
              class="settings-nav-item"
              :class="{ active: activeSection === sec.id }"
              type="button"
              @click="selectSection(sec.id)"
            >
              <AppIcon :name="sec.icon" />
              <span>{{ sec.label }}</span>
            </button>
            <p v-if="visibleSections.length === 0" class="settings-nav-empty">
              没有匹配的设置
            </p>
          </nav>
        </aside>

        <!-- 右侧：内容区 -->
        <section class="settings-main">
          <!-- 数据源：自管滚动，独占内容区 -->
          <div v-if="currentSection.id === 'sources'" class="settings-sources">
            <SourceManagerPanel embedded :visible="visible" />
          </div>

          <!-- 其余分区：统一滚动 -->
          <div v-else class="settings-scroll custom-scrollbar" :class="{ 'settings-amane': currentSection.id === 'amane' }">
            <AmaneSettings
              v-if="currentSection.id === 'amane'"
              ref="amanePanel"
              :status="amaneStatus"
              :initial-section="amaneInitialSection"
              @changed="amaneStatus = $event"
            />
            <!-- 外观 -->
            <template v-if="currentSection.id === 'appearance'">
              <div class="st-group">
                <div class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">主题</div>
                    <div class="st-row-desc">深色 / 浅色界面，可随时切换</div>
                  </div>
                  <div class="yb-seg-group st-seg-md">
                    <button
                      class="yb-seg"
                      :class="{ 'is-active': isDark }"
                      @click="setTheme('dark')"
                    >
                      深色
                    </button>
                    <button
                      class="yb-seg"
                      :class="{ 'is-active': !isDark }"
                      @click="setTheme('light')"
                    >
                      浅色
                    </button>
                  </div>
                </div>
              </div>
            </template>

            <!-- 图片质量 -->
            <template v-if="currentSection.id === 'images'">
              <div class="st-group">
                <div class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">海报</div>
                    <div class="st-row-desc">影片封面图的下载尺寸</div>
                  </div>
                  <div class="yb-seg-group st-seg-sm">
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
                <div class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">背景图</div>
                    <div class="st-row-desc">详情页背景的下载尺寸</div>
                  </div>
                  <div class="yb-seg-group st-seg-sm">
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
                <div class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">演员</div>
                    <div class="st-row-desc">演员头像的下载尺寸</div>
                  </div>
                  <div class="yb-seg-group st-seg-sm">
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
            </template>

            <!-- 刮削 -->
            <template v-if="currentSection.id === 'scrape'">
              <div class="st-group">
                <div class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">并发任务数</div>
                    <div class="st-row-desc">
                      同时进行的刮削任务数量；网络好可调高，遇限流（429）建议调低
                    </div>
                  </div>
                  <div class="yb-seg-group st-seg-md">
                    <button
                      v-for="opt in concurrencyOptions"
                      :key="opt.value"
                      class="yb-seg"
                      :class="{ 'is-active': scrapeConcurrency === opt.value }"
                      @click="scrapeConcurrency = opt.value"
                    >
                      {{ opt.short }}
                    </button>
                  </div>
                </div>
                <div class="st-row st-row-col">
                  <div class="st-row-text">
                    <div class="st-row-title">元数据语言</div>
                    <div class="st-row-desc">
                      刮削时从 TMDB 获取的标题、简介、演员等信息的语言
                    </div>
                  </div>
                  <div class="yb-seg-group st-seg-wrap">
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
                </div>
              </div>
            </template>

            <!-- 服务 -->
            <template v-if="currentSection.id === 'provider'">
              <div class="st-group">
                <div class="st-row st-row-col">
                  <div class="st-row-text">
                    <div class="st-row-title">刮削服务</div>
                    <div class="st-row-desc">选择元数据刮削服务提供者</div>
                  </div>
                  <div class="st-cards">
                    <div
                      v-for="opt in providerOptions"
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
                      <div class="st-card-text">
                        <div class="st-card-title">{{ opt.label }}</div>
                        <div class="st-card-desc">{{ opt.desc }}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-if="currentProvider === 'tmdb'" class="st-row st-row-col">
                  <div class="st-row-text">
                    <div class="st-row-title">TMDB Access Token</div>
                    <div class="st-row-desc">
                      前往
                      <a
                        href="https://www.themoviedb.org/settings/api"
                        target="_blank"
                        class="yb-link"
                        >TMDB API 设置</a
                      >
                      获取 Read Access Token
                    </div>
                  </div>
                  <textarea
                    v-model="tmdbAccessToken"
                    rows="3"
                    class="yb-field st-field resize-none"
                    placeholder="输入 TMDB API Read Access Token（必填，无内置默认值）"
                  />
                  <p v-if="!tmdbAccessToken" class="st-warn">
                    尚未配置 Token，TMDB 搜索与刮削不可用
                  </p>
                </div>
              </div>

              <div class="st-group">
                <div class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">Go 后端地址</div>
                    <div class="st-row-desc">
                      需先在
                      <code class="st-code">packages/backend/</code>
                      目录下启动 Go 服务
                    </div>
                  </div>
                  <input
                    v-model="goBackendUrl"
                    type="text"
                    placeholder="http://localhost:31471"
                    class="yb-field st-field-md"
                  />
                </div>
                <div class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">访问密钥</div>
                    <div class="st-row-desc">
                      仅当后端设置了
                      <code class="st-code">YINGBOX_API_KEY</code>
                      时需要；仅本机使用可留空
                    </div>
                  </div>
                  <input
                    v-model="goBackendApiKey"
                    type="password"
                    autocomplete="off"
                    placeholder="可选"
                    class="yb-field st-field-md"
                  />
                </div>
                <div class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">连接状态</div>
                    <div class="st-row-desc">保存后可测试后端是否可达</div>
                  </div>
                  <button
                    type="button"
                    class="yb-btn-soft st-action"
                    :class="
                      goTestStatus === 'ok'
                        ? 'yb-status-ok'
                        : goTestStatus === 'fail'
                          ? 'yb-status-fail'
                          : ''
                    "
                    :disabled="!goBackendUrl || goTestStatus === 'testing'"
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

                <template v-if="currentProvider === 'custom'">
                  <div class="st-row">
                    <div class="st-row-text">
                      <div class="st-row-title">服务名称</div>
                    </div>
                    <input
                      v-model="customProviderName"
                      type="text"
                      placeholder="例如：我的刮削服务"
                      class="yb-field st-field-md"
                    />
                  </div>
                  <div class="st-row">
                    <div class="st-row-text">
                      <div class="st-row-title">API 基础 URL</div>
                      <div class="st-row-desc">
                        自定义服务需实现与 TMDB 兼容的接口格式
                      </div>
                    </div>
                    <input
                      v-model="customBaseUrl"
                      type="text"
                      placeholder="https://api.example.com"
                      class="yb-field st-field-md"
                    />
                  </div>
                  <div class="st-row">
                    <div class="st-row-text">
                      <div class="st-row-title">API Key</div>
                    </div>
                    <input
                      v-model="customApiKey"
                      type="password"
                      autocomplete="off"
                      placeholder="输入 API Key"
                      class="yb-field st-field-md"
                    />
                  </div>
                </template>
              </div>

              <div class="st-group">
                <div class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">重置刮削配置</div>
                    <div class="st-row-desc">清除已保存的服务与后端配置</div>
                  </div>
                  <button
                    type="button"
                    class="yb-btn-soft st-action"
                    @click="resetProviderConfig"
                  >
                    重置
                  </button>
                </div>
              </div>
            </template>

            <!-- 播放器 -->
            <template v-if="currentSection.id === 'player'">
              <div class="st-group">
                <div class="st-row st-row-col">
                  <div class="st-row-text">
                    <div class="st-row-title">播放引擎</div>
                    <div class="st-row-desc">选择视频播放时使用的核心引擎</div>
                  </div>
                  <div class="st-cards">
                    <div
                      v-for="opt in playerEngineOptions"
                      :key="opt.value"
                      class="yb-choice-card"
                      :class="{ 'is-active': preferredPlayerEngine === opt.value }"
                      @click="preferredPlayerEngine = opt.value"
                    >
                      <div
                        class="yb-radio"
                        :class="{ 'is-active': preferredPlayerEngine === opt.value }"
                      >
                        <div
                          v-if="preferredPlayerEngine === opt.value"
                          class="yb-radio-dot"
                        />
                      </div>
                      <div class="st-card-text">
                        <div class="st-card-title">{{ opt.label }}</div>
                        <div class="st-card-desc">{{ opt.desc }}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  v-if="preferredPlayerEngine === 'mpv'"
                  class="st-row st-row-col"
                >
                  <p class="st-row-desc">
                    提示：使用 mpv 需要系统已安装 mpv 或配置环境变量
                    YINGBOX_MPV_PATH。若未检测到会自动回退至内置播放器。
                  </p>
                </div>
                <div v-if="preferredPlayerEngine === 'mpv'" class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">RTX 视频超分</div>
                    <div class="st-row-desc">
                      仅 Windows + NVIDIA 显卡有效：片源低于 1080p
                      时自动调用 NVIDIA 视频超分（需在 NVIDIA app 中打开「视频超级分辨率」）
                    </div>
                  </div>
                  <button
                    class="st-switch"
                    :class="{ 'is-on': rtxVsrEnabled }"
                    type="button"
                    role="switch"
                    :aria-checked="rtxVsrEnabled"
                    aria-label="RTX 视频超分"
                    @click="rtxVsrEnabled = !rtxVsrEnabled"
                  >
                    <span class="st-switch-thumb" />
                  </button>
                </div>
                <div
                  v-if="preferredPlayerEngine === 'mpv' && mpvState.running"
                  class="st-row st-row-col"
                >
                  <p class="st-row-desc">当前播放：{{ mpvResolutionText }}</p>
                </div>
              </div>
            </template>

            <!-- 去马赛克（lada） -->
            <template v-if="currentSection.id === 'lada'">
              <div class="st-group">
                <div class="st-row st-row-col">
                  <p class="st-row-desc">
                    影盒只负责调度：实际修复由外部工具 lada 完成（AGPL-3.0，需另行安装）。
                    下面两项会自动探测，也可手动指定。
                  </p>
                </div>
                <div class="st-row st-row-col">
                  <p class="st-row-desc">lada-cli</p>
                  <div class="flex items-center gap-2 w-full">
                    <input
                      v-model="ladaCli"
                      type="text"
                      class="yb-field flex-1"
                      placeholder="未找到，请点右侧选择"
                      readonly
                    />
                    <button class="yb-btn-soft whitespace-nowrap" @click="pickLadaCli">
                      选择…
                    </button>
                    <button class="yb-btn-soft whitespace-nowrap" @click="resetLadaPath('cli')">
                      自动
                    </button>
                  </div>
                </div>
                <div class="st-row st-row-col">
                  <p class="st-row-desc">ffmpeg</p>
                  <div class="flex items-center gap-2 w-full">
                    <input
                      v-model="ladaFfmpeg"
                      type="text"
                      class="yb-field flex-1"
                      placeholder="未找到，请点右侧选择"
                      readonly
                    />
                    <button class="yb-btn-soft whitespace-nowrap" @click="pickFfmpeg">
                      选择…
                    </button>
                    <button class="yb-btn-soft whitespace-nowrap" @click="resetLadaPath('ffmpeg')">
                      自动
                    </button>
                  </div>
                </div>
                <div v-if="ladaHint" class="st-row st-row-col">
                  <p class="st-row-desc">{{ ladaHint }}</p>
                </div>
              </div>
            </template>

            <!-- 软件更新 -->
            <template v-if="currentSection.id === 'update'">
              <div class="st-group">
                <div class="st-row">
                  <div class="st-row-text">
                    <div class="st-row-title">{{ updateTitle }}</div>
                    <div class="st-row-desc">{{ updateMessage }}</div>
                  </div>
                  <button
                    v-if="updateAction"
                    type="button"
                    class="yb-btn-soft st-action"
                    :disabled="updateBusy"
                    @click="handleUpdateAction"
                  >
                    {{ updateAction }}
                  </button>
                </div>
                <div
                  v-if="updateStatus === 'downloading'"
                  class="st-row st-row-col"
                >
                  <div class="st-progress">
                    <div
                      class="st-progress-bar"
                      :style="{ width: `${updateProgress}%` }"
                    />
                  </div>
                </div>
              </div>
            </template>
          </div>
        </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AmaneStatus } from '../../../shared/amane'
import {
  type ScrapeProviderType,
  getScrapeProviderConfig,
  saveScrapeProviderConfig,
} from '@/stores/scrape-provider-store'
import { backend } from '@/api/backend'
import { useTheme } from '@/utils/theme'
import {
  getRtxVsrEnabled,
  setRtxVsrEnabled,
  syncRtxVsr,
} from '@/composables/use-media-player'
import { useMpvPlayer } from '@/composables/use-mpv-player'
import SourceManagerPanel from '@/components/SourceManagerPanel.vue'
import AppIcon from '@/components/AppIcon.vue'
import AmaneSettings from '@/views/Amane/Settings.vue'

const props = defineProps<{ visible: boolean; initialSection?: string }>()
const emit = defineEmits<{ close: [] }>()
const amanePanel = ref<InstanceType<typeof AmaneSettings> | null>(null)

// ── 分区导航 ────────────────────────────────────────────────
type SectionId =
  | 'appearance'
  | 'images'
  | 'scrape'
  | 'provider'
  | 'sources'
  | 'player'
  | 'lada'
  | 'update'
  | 'amane'

const sections: {
  id: SectionId
  label: string
  icon: 'sun' | 'image' | 'download' | 'database' | 'grid' | 'play' | 'refresh'
  keywords: string
}[] = [
  { id: 'appearance', label: '外观', icon: 'sun', keywords: '主题 深色 浅色' },
  {
    id: 'images',
    label: '图片质量',
    icon: 'image',
    keywords: '海报 背景图 演员 尺寸',
  },
  {
    id: 'scrape',
    label: '刮削',
    icon: 'download',
    keywords: '并发 元数据 语言 tmdb',
  },
  {
    id: 'provider',
    label: '服务',
    icon: 'database',
    keywords: 'tmdb token 后端 密钥 自定义 连接',
  },
  {
    id: 'sources',
    label: '数据源',
    icon: 'grid',
    keywords: 'cms av 在线源 插件 站点',
  },
  { id: 'player', label: '播放器', icon: 'play', keywords: 'mpv 引擎 artplayer' },
  { id: 'lada', label: '去马赛克', icon: 'image', keywords: 'lada 去码 马赛克 无码 mpv 路径' },
  { id: 'update', label: '软件更新', icon: 'refresh', keywords: '版本 下载 重启' },
  { id: 'amane', label: 'Amane', icon: 'database', keywords: 'Amane 片库 连接 存储 刮削 智能体 水印 超分' },
]

const navQuery = ref('')
const activeSection = ref<SectionId>('appearance')
const amaneStatus = ref<AmaneStatus | null>(null)
const amaneInitialSection = ref('connection')
watch(() => [props.visible, props.initialSection] as const, ([visible, initial]) => {
  if (!visible || !initial) return
  const amaneTarget = initial.startsWith('amane:')
  const section = amaneTarget ? 'amane' : initial
  if (!sections.some(item => item.id === section)) return
  if (selectSection(section as SectionId)) {
    navQuery.value = ''
    amaneInitialSection.value = amaneTarget ? initial.slice('amane:'.length) : 'connection'
  }
})

const visibleSections = computed(() => {
  const q = navQuery.value.trim().toLowerCase()
  if (!q) return sections
  return sections.filter(s =>
    `${s.label} ${s.keywords}`.toLowerCase().includes(q)
  )
})

watch(navQuery, () => {
  const vis = visibleSections.value
  if (vis.length && !vis.some(s => s.id === activeSection.value)) {
    if (selectSection(vis[0].id)) return
    navQuery.value = ''
  }
})

function canLeaveAmane(): boolean {
  return activeSection.value !== 'amane' || amanePanel.value?.canLeave() !== false
}

function selectSection(section: SectionId): boolean {
  if (!canLeaveAmane()) return false
  if (section === 'amane' && activeSection.value !== 'amane') amaneInitialSection.value = 'connection'
  activeSection.value = section
  return true
}

function requestClose(): void {
  if (canLeaveAmane()) emit('close')
}

const currentSection = computed(
  () =>
    sections.find(s => s.id === activeSection.value) ??
    visibleSections.value[0] ??
    sections[0]
)

watch(
  () => [props.visible, activeSection.value] as const,
  async ([visible, section]) => {
    if (visible && section === 'amane' && window.api?.amane) {
      try { amaneStatus.value = await window.api.amane.status() } catch { /* Amane settings report connection errors inline */ }
    }
    if (visible && section === 'lada') void loadLadaPaths()
  },
  { immediate: true }
)

// ── 去马赛克（lada）：外部工具路径 ───────────────────────────
const ladaCli = ref('')
const ladaFfmpeg = ref('')
const ladaHint = ref('')

async function loadLadaPaths(): Promise<void> {
  if (!window.api?.lada?.paths) return
  try {
    const paths = await window.api.lada.paths()
    ladaCli.value = paths.cli
    ladaFfmpeg.value = paths.ffmpeg
    ladaHint.value = !paths.cli
      ? '未探测到 lada-cli：请先安装 lada，或手动选择 lada-cli.exe'
      : paths.cliOverridden
        ? 'lada-cli：使用手动指定的路径'
        : 'lada-cli：已自动探测。修复产物为同目录的 .restored.mp4，播放时会优先选它。'
  } catch (e) {
    ladaHint.value = (e as Error).message
  }
}

async function applyLadaPaths(changes: { cli?: string; ffmpeg?: string }): Promise<void> {
  try {
    await window.api.lada.setPaths(changes)
    await loadLadaPaths()
  } catch (e) {
    ladaHint.value = (e as Error).message
  }
}

async function pickLadaCli(): Promise<void> {
  const res = await window.api.dialog.openFile({
    title: '选择 lada-cli.exe',
    properties: ['openFile'],
    filters: [{ name: 'lada-cli', extensions: ['exe'] }],
  })
  if (res?.filePaths?.[0]) await applyLadaPaths({ cli: res.filePaths[0] })
}

async function pickFfmpeg(): Promise<void> {
  const res = await window.api.dialog.openFile({
    title: '选择 ffmpeg.exe',
    properties: ['openFile'],
    filters: [{ name: 'ffmpeg', extensions: ['exe'] }],
  })
  if (res?.filePaths?.[0]) await applyLadaPaths({ ffmpeg: res.filePaths[0] })
}

async function resetLadaPath(which: 'cli' | 'ffmpeg'): Promise<void> {
  await applyLadaPaths(which === 'cli' ? { cli: '' } : { ffmpeg: '' })
}

// ── 外观：主题 ──────────────────────────────────────────────
const { isDark, setTheme } = useTheme()

// ── 图片质量 ────────────────────────────────────────────────
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

// ── 刮削并发 ────────────────────────────────────────────────
const concurrencyOptions = [
  { value: '1', short: '1' },
  { value: '2', short: '2' },
  { value: '3', short: '3' },
  { value: '4', short: '4' },
  { value: '6', short: '6' },
  { value: '8', short: '8' },
]

const scrapeConcurrency = ref(localStorage.getItem('scrapeConcurrency') || '3')

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
watch(
  scrapeConcurrency,
  val => localStorage.setItem('scrapeConcurrency', val),
  { immediate: true }
)

// ── 元数据语言 ──────────────────────────────────────────────
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

// ── 播放器引擎 ──────────────────────────────────────────────
const playerEngineOptions: {
  value: 'built-in' | 'mpv'
  label: string
  desc: string
}[] = [
  {
    value: 'built-in',
    label: '内置网页播放器 (Artplayer)',
    desc: '轻量快速，支持 HLS 流与常规 mp4/webm 格式',
  },
  {
    value: 'mpv',
    label: 'mpv 高级播放器 (推荐)',
    desc: '全格式硬解，支持 ASS 特效字幕、多音轨与 HDR/4K 高码率',
  },
]
const preferredPlayerEngine = ref<'built-in' | 'mpv'>(
  (localStorage.getItem('preferred_player_engine') as 'built-in' | 'mpv') ||
    'built-in'
)
watch(preferredPlayerEngine, val => {
  localStorage.setItem('preferred_player_engine', val)
})

// ── RTX 视频超分（NVIDIA） ─────────────────────────────────
const { status: mpvState } = useMpvPlayer()
const rtxVsrEnabled = ref(getRtxVsrEnabled())
watch(rtxVsrEnabled, val => {
  setRtxVsrEnabled(val)
  syncRtxVsr()
})

/** 当前播放分辨率文案：片源 →（超分后） */
const mpvResolutionText = computed(() => {
  const {
    videoWidth: w,
    videoHeight: h,
    vsrWidth: vw,
    vsrHeight: vh,
    vsr,
  } = mpvState.value
  if (!w || !h) return '读取中…'
  const source = `${w}×${h}`
  if (vsr && vw && vh) {
    const scale = Math.round((vw / w) * 10) / 10
    return `${source} → ${vw}×${vh}（RTX 超分 ${scale}×）`
  }
  return `${source}（未超分：片源 ≥ 1080p 或设备不支持）`
})

// ── 刮削服务 ────────────────────────────────────────────────
const providerOptions: {
  value: ScrapeProviderType
  label: string
  desc: string
}[] = [
  {
    value: 'tmdb',
    label: 'TMDB',
    desc: 'The Movie Database，全球最大的电影数据库',
  },
  { value: 'custom', label: '自定义服务', desc: '接入自己的刮削 API' },
]

const _config = getScrapeProviderConfig()
const currentProvider = ref<ScrapeProviderType>(_config.provider)
const tmdbAccessToken = ref(_config.tmdbAccessToken)
const customProviderName = ref(_config.customProviderName)
const customBaseUrl = ref(_config.customBaseUrl)
const customApiKey = ref(_config.customApiKey)
const goBackendUrl = ref(_config.goBackendUrl || 'http://localhost:31471')
const goBackendApiKey = ref(_config.goBackendApiKey || '')
const goTestStatus = ref<'idle' | 'testing' | 'ok' | 'fail'>('idle')

// ── 软件更新 ────────────────────────────────────────────────
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
  if (updateStatus.value === 'available')
    return `发现新版本 ${updateVersion.value || ''}`.trim()
  if (updateStatus.value === 'not-available') return '当前已是最新版本'
  if (updateStatus.value === 'downloading') return '正在下载更新'
  if (updateStatus.value === 'downloaded') return '更新已下载'
  if (updateStatus.value === 'error') return '更新检查失败'
  return '检查软件更新'
})

const updateMessage = computed(() => {
  if (updateStatus.value === 'checking') return '正在连接 GitHub Releases...'
  if (updateStatus.value === 'available')
    return '可以下载新版本，下载完成后可重启安装'
  if (updateStatus.value === 'not-available') return '你的影盒版本已经是最新'
  if (updateStatus.value === 'downloading')
    return `下载进度 ${updateProgress.value.toFixed(1)}%`
  if (updateStatus.value === 'downloaded')
    return '点击重启安装，应用会自动关闭并完成更新'
  if (updateStatus.value === 'error') return updateError.value || '请稍后重试'
  return '从 GitHub Release 检查是否有新版本'
})

const updateAction = computed(() => {
  if (updateStatus.value === 'available') return '下载更新'
  if (updateStatus.value === 'downloaded') return '重启安装'
  if (updateStatus.value === 'checking' || updateStatus.value === 'downloading')
    return ''
  return '检查更新'
})

const handleUpdateStatus = (status: any) => {
  updateStatus.value = status.status || 'idle'
  updateBusy.value =
    status.status === 'checking' || status.status === 'downloading'
  if (status.info?.version) updateVersion.value = status.info.version
  if (status.progress?.percent != null)
    updateProgress.value = status.progress.percent
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
    if (
      updateStatus.value !== 'checking' &&
      updateStatus.value !== 'downloading'
    ) {
      updateBusy.value = false
    }
  }
}

window.api?.update?.onStatus?.(handleUpdateStatus)
onBeforeUnmount(() => window.api?.update?.offStatus?.())

// ── 服务配置加载 / 保存 ──────────────────────────────────────
const loadConfig = () => {
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

// ── 打开/关闭行为 ───────────────────────────────────────────
watch(
  () => props.visible,
  v => {
    if (v) {
      loadConfig()
      navQuery.value = ''
      window.addEventListener('keydown', onKeydown)
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  }
)

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') requestClose()
}

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: rgba(0, 0, 0, 0.44);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.settings-window {
  position: fixed;
  inset: 0;
  z-index: 2101;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.settings-body { display:flex; flex:1; min-height:0; min-width:0; }
.settings-frame {
  flex-direction:column;
  pointer-events: auto;
  display: flex;
  width: min(980px, calc(100vw - 48px));
  height: min(740px, calc(100vh - 72px));
  overflow: hidden;
  color: var(--text-primary);
  background: var(--bg-main);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* ── 左侧导航 ── */
.settings-nav {
  display: flex;
  flex: 0 0 216px;
  flex-direction: column;
  min-height: 0;
  padding: 18px 12px;
  background: var(--bg-sidebar-solid);
  border-right: 1px solid var(--separator);
}

.settings-search {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  height: 32px;
  margin-bottom: 10px;
  padding: 0 10px;
  color: var(--text-tertiary);
  background: var(--bg-fill-secondary);
  border-radius: var(--radius-md);
}

.settings-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: none !important;
  box-shadow: none !important;
  color: var(--text-primary);
  background: transparent;
  font-size: var(--text-sm);
  appearance: none;
  -webkit-appearance: none;
}
.settings-search input::placeholder {
  color: var(--text-tertiary);
}

.settings-nav-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
  overflow-y: auto;
}

.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  background: transparent;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: var(--transition-fast);
}
.settings-nav-item:hover {
  color: var(--text-primary);
  background: var(--bg-glass);
}
.settings-nav-item.active {
  color: var(--text-primary);
  background: var(--accent-soft);
  font-weight: var(--font-weight-medium);
}
.settings-nav-empty {
  margin: 10px 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ── 右侧内容 ── */
.settings-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.settings-scroll {
  flex: 1;
  min-height: 0;
  padding: 12px 30px 30px;
  overflow-y: auto;
}

.settings-sources {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 14px 16px 16px;
}
.settings-sources > * {
  flex: 1;
  min-height: 0;
}

/* ── 设置行（分组 + 右置控件） ── */
.st-group {
  margin-bottom: 20px;
  background: transparent;
  border-radius: 0;
  overflow: hidden;

  border-bottom: 1px solid var(--border-default);
}

.st-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 64px;
  padding: 15px 0;
}
.st-row + .st-row {
  border-top: 1px solid var(--separator);
}
.st-row-col {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.st-row-text {
  min-width: 0;
}
.st-row-title {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}
.st-row-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.st-seg-sm {
  flex: 0 0 auto;
  width: 190px;
}
.st-seg-md {
  flex: 0 0 auto;
  width: 300px;
}
.st-seg-sm .yb-seg,
.st-seg-md .yb-seg {
  flex: 1 1 0;
  min-width: 0;
  padding: 4px 8px;
  min-height: 28px;
}
.st-seg-wrap {
  display: flex;
  flex-wrap: wrap;
  width: 100%;
}
.st-seg-wrap .yb-seg {
  flex: 1 1 auto;
  min-width: 72px;
}

/* 开关（布尔设置项，如 RTX 视频超分） */
.st-switch {
  position: relative;
  flex: 0 0 auto;
  width: 42px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
  cursor: pointer;
  transition: var(--transition-fast);
}
.st-switch:hover {
  background: var(--accent-soft);
}
.st-switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--bg-elevated);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  transition: var(--transition-fast);
}
.st-switch.is-on {
  background: var(--accent);
}
.st-switch.is-on:hover {
  background: var(--accent-hover);
}
.st-switch.is-on .st-switch-thumb {
  transform: translateX(18px);
  background: var(--text-on-accent);
  box-shadow: none;
}

.st-cards {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.st-card-text {
  flex: 1;
  min-width: 0;
}
.st-card-title {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}
.st-card-desc {
  font-size: 10px;
  color: var(--text-tertiary);
}

.st-field {
  font-size: var(--text-sm);
}
.st-field-md {
  flex: 0 0 auto;
  width: 300px;
  min-height: 32px;
  padding: 6px 12px;
  font-size: var(--text-sm);
}

.st-action {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 14px;
  font-size: var(--text-xs);
}

.st-warn {
  margin: 0;
  font-size: 10px;
  color: var(--danger);
}

.st-code {
  padding: 0 4px;
  border-radius: 4px;
  font-size: 10px;
  background: var(--bg-fill-secondary);
}

.st-progress {
  height: 6px;
  overflow: hidden;
  background: var(--bg-fill-secondary);
  border-radius: var(--radius-full);
}
.st-progress-bar {
  height: 100%;
  background: var(--accent);
  border-radius: var(--radius-full);
  transition: width 0.35s var(--ease-out);
}

/* ── 动效 ── */
.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity 0.2s var(--ease-out);
}
.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}

.settings-pop-enter-active {
  transition: opacity 0.2s var(--ease-out);
}
.settings-pop-enter-active .settings-frame {
  transition:
    opacity 0.2s var(--ease-out),
    transform 0.2s var(--ease-out);
}
.settings-pop-enter-from {
  opacity: 0;
}
.settings-pop-enter-from .settings-frame {
  opacity: 0;
  transform: scale(0.97) translateY(10px);
}
.settings-pop-leave-active {
  transition: opacity 0.16s ease;
}
.settings-pop-leave-active .settings-frame {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}
.settings-pop-leave-to {
  opacity: 0;
}
.settings-pop-leave-to .settings-frame {
  opacity: 0;
  transform: scale(0.985) translateY(6px);
}

/* ── 窄屏：整窗 + 顶部横向分区 ── */
@media (max-width: 720px) {
  .settings-frame {
    flex-direction: column;
    width: 100vw;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }
  .settings-nav {
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 10px 12px;
    border-right: 0;
    border-bottom: 1px solid var(--separator);
  }
  .settings-search {
    flex: 0 0 auto;
    width: 132px;
    margin-bottom: 0;
  }
  .settings-nav-list {
    flex: 1;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .settings-nav-item {
    width: auto;
    white-space: nowrap;
  }
  .settings-nav-empty {
    display: none;
  }
  .settings-scroll {
    padding: 14px 16px 24px;
  }
  .settings-sources {
    padding: 10px 12px 12px;
  }
  .st-row {
    flex-wrap: wrap;
  }
  .st-field-md {
    width: 100%;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .settings-frame {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: var(--bg-elevated);
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-pop-enter-active,
  .settings-pop-leave-active,
  .settings-pop-enter-active .settings-frame,
  .settings-pop-leave-active .settings-frame {
    transition: opacity 0.2s ease;
  }
  .settings-pop-enter-from .settings-frame,
  .settings-pop-leave-to .settings-frame {
    transform: none;
  }
  .st-progress-bar {
    transition: none;
  }
}

.settings-scroll.settings-amane :deep(.amane-settings) {
  display: grid;
  grid-template-columns: minmax(150px, 190px) minmax(0, 1fr);
  align-items: start;
  gap: 22px;
}

.settings-scroll.settings-amane :deep(.amane-settings-nav) {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 12px 4px 0;
  border: 0;
  border-right: 1px solid var(--separator);
  border-radius: 0;
}

.settings-scroll.settings-amane :deep(.amane-config-settings.is-integrated) {
  display: block;
  padding: 0;
}

.settings-scroll.settings-amane :deep(.amane-settings-nav button) {
  min-height: 36px;
  padding: 8px 11px;
  border-radius: var(--radius-md);
}

.settings-scroll.settings-amane :deep(.amane-config-panel) {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.settings-scroll.settings-amane :deep(.amane-config-save) {
  position: static;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--separator);
  background: transparent;
}

@media (max-width: 900px) {
  .settings-scroll.settings-amane :deep(.amane-settings) {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
  }

  .settings-scroll.settings-amane :deep(.amane-settings-nav) {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--separator);
    padding: 0 0 8px;
  }

  .settings-scroll.settings-amane :deep(.amane-settings-nav button) {
    flex: 0 0 auto;
    white-space: nowrap;
  }
}
@media(max-width:720px) { .settings-body { flex-direction:column; } }
</style>
