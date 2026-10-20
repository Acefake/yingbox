<template>
  <!-- 遮罩层 -->
  <Transition name="settings-fade">
    <div v-if="visible" class="settings-backdrop" @click="requestClose" />
  </Transition>

  <!-- 设置窗口：左侧分区导航 + 右侧分组内容（macOS 系统设置式） -->
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
        <DialogTitlebar title="设置" icon="settings" @close="requestClose" />
        <div class="settings-body">
          <!-- 左侧：搜索 + 分区导航 -->
          <aside class="settings-nav">
            <div class="settings-search">
              <UiIcon name="search" size="sm" />
              <input
                v-model="navQuery"
                placeholder="搜索设置"
                type="text"
                aria-label="搜索设置"
              />
            </div>
            <nav class="settings-nav-list" aria-label="设置分区">
              <UiNavItem
                v-for="sec in visibleSections"
                :key="sec.id"
                class="settings-nav-item"
                :label="sec.label"
                :icon="sec.icon"
                :active="activeSection === sec.id"
                @click="selectSection(sec.id)"
              />
              <p v-if="visibleSections.length === 0" class="settings-nav-empty">
                没有匹配的设置
              </p>
            </nav>
          </aside>

          <!-- 右侧：内容区 -->
          <section class="settings-main" :aria-label="currentSection.label">
            <h2 class="settings-main-title">{{ currentSection.label }}</h2>

            <!-- 数据源：自管滚动，独占内容区 -->
            <div
              v-if="currentSection.id === 'sources'"
              class="settings-sources"
            >
              <SourceManagerPanel embedded :visible="visible" />
            </div>

            <!-- 其余分区：统一滚动 -->
            <div
              v-else
              class="settings-scroll custom-scrollbar"
              :class="{ 'settings-amane': currentSection.id === 'amane' }"
            >
              <AmaneSettings
                v-if="currentSection.id === 'amane'"
                ref="amanePanel"
                :status="amaneStatus"
                :initial-section="amaneInitialSection"
                @changed="amaneStatus = $event"
              />
              <AppearanceSettings
                v-else-if="currentSection.id === 'appearance'"
              />
              <ImageSettings v-else-if="currentSection.id === 'images'" />
              <ScrapeSettings v-else-if="currentSection.id === 'scrape'" />
              <ProviderSettings v-else-if="currentSection.id === 'provider'" />
              <PlayerSettings v-else-if="currentSection.id === 'player'" />
              <LadaSettings v-else-if="currentSection.id === 'lada'" />
              <UpdateSettings
                v-else-if="currentSection.id === 'update'"
                :update="update"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * 全局设置窗口。
 *
 * 本组件只负责外壳：遮罩、标题栏、左侧分区导航（含搜索）和右侧内容切换；
 * 每个分区的界面与持久化逻辑在 components/settings/*Settings.vue 中，
 * 只在分区打开时挂载（打开即读取最新配置）。
 *
 * 例外：软件更新状态需要在窗口关闭时也持续接收，所以 useUpdateStatus 常驻在这里。
 * Amane 分区有未保存修改时，切换分区和关闭窗口都会被它的 canLeave() 拦下。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import AppearanceSettings from '@/components/settings/AppearanceSettings.vue'
import ImageSettings from '@/components/settings/ImageSettings.vue'
import LadaSettings from '@/components/settings/LadaSettings.vue'
import PlayerSettings from '@/components/settings/PlayerSettings.vue'
import ProviderSettings from '@/components/settings/ProviderSettings.vue'
import ScrapeSettings from '@/components/settings/ScrapeSettings.vue'
import UpdateSettings from '@/components/settings/UpdateSettings.vue'
import { useUpdateStatus } from '@/components/settings/use-update-status'
import SourceManagerPanel from '@/components/SourceManagerPanel.vue'
import type { IconName } from '@/components/ui/icons'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'
import AmaneSettings from '@/views/Amane/Settings.vue'

import type { AmaneStatus } from '../../../shared/amane'

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

interface SectionMeta {
  id: SectionId
  label: string
  icon: IconName
  /** 搜索设置时额外匹配的关键词 */
  keywords: string
}

const sections: SectionMeta[] = [
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
    icon: 'globe',
    keywords: 'tmdb token 后端 密钥 自定义 连接',
  },
  {
    id: 'sources',
    label: '数据源',
    icon: 'database',
    keywords: 'cms av 在线源 插件 站点',
  },
  {
    id: 'player',
    label: '播放器',
    icon: 'play',
    keywords: 'mpv 引擎 artplayer',
  },
  {
    id: 'lada',
    label: '去马赛克',
    icon: 'wand',
    keywords: 'lada 去码 马赛克 无码 mpv 路径',
  },
  {
    id: 'update',
    label: '软件更新',
    icon: 'refresh',
    keywords: '版本 下载 重启',
  },
  {
    id: 'amane',
    label: 'Amane',
    icon: 'movie',
    keywords: 'Amane 片库 连接 存储 刮削 智能体 水印 超分',
  },
]

const navQuery = ref('')
const activeSection = ref<SectionId>('appearance')
const amaneStatus = ref<AmaneStatus | null>(null)
const amaneInitialSection = ref('connection')
watch(
  () => [props.visible, props.initialSection] as const,
  ([visible, initial]) => {
    if (!visible || !initial) return
    const amaneTarget = initial.startsWith('amane:')
    const section = amaneTarget ? 'amane' : initial
    if (!sections.some(item => item.id === section)) return
    if (selectSection(section as SectionId)) {
      navQuery.value = ''
      amaneInitialSection.value = amaneTarget
        ? initial.slice('amane:'.length)
        : 'connection'
    }
  }
)

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

/** Amane 分区有未保存修改时由它自己确认，返回 false 表示留在原处 */
function canLeaveAmane(): boolean {
  return (
    activeSection.value !== 'amane' || amanePanel.value?.canLeave() !== false
  )
}

function selectSection(section: SectionId): boolean {
  if (!canLeaveAmane()) return false
  if (section === 'amane' && activeSection.value !== 'amane')
    amaneInitialSection.value = 'connection'
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
      try {
        amaneStatus.value = await window.api.amane.status()
      } catch {
        /* Amane settings report connection errors inline */
      }
    }
  },
  { immediate: true }
)

// ── 软件更新：常驻订阅，窗口关闭时也接收状态 ─────────────────
const update = useUpdateStatus()

// ── 打开/关闭行为 ───────────────────────────────────────────
const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') requestClose()
}

watch(
  () => props.visible,
  v => {
    if (v) {
      navQuery.value = ''
      window.addEventListener('keydown', onKeydown)
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  }
)

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

.settings-frame {
  display: flex;
  flex-direction: column;
  width: min(980px, calc(100vw - 48px));
  height: min(740px, calc(100vh - 72px));
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-main);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}

.settings-body {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* ── 左侧导航：靠底色和内容区分开，不画分隔线 ── */
.settings-nav {
  display: flex;
  flex: 0 0 216px;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-4) var(--space-3);
  background: var(--bg-sidebar);
}

.settings-search {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-2);
  height: var(--control-height-sm);
  margin-bottom: var(--space-3);
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  background: var(--bg-glass);
  color: var(--text-tertiary);
  transition: var(--transition-fast);
}
.settings-search:focus-within {
  box-shadow: var(--focus-ring);
}
.settings-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text-primary);
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

/* 分区导航项即 UiNavItem 的默认外观，这里不再重复 */
.settings-nav-empty {
  margin: var(--space-2) var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

/* ── 右侧内容 ── */
.settings-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.settings-main-title {
  flex: 0 0 auto;
  margin: 0;
  padding: var(--space-6) var(--space-7) var(--space-4);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
}

.settings-scroll {
  flex: 1;
  min-height: 0;
  padding: 0 var(--space-7) var(--space-7);
  overflow-y: auto;
}

.settings-sources {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0 var(--space-7) var(--space-4);
}
.settings-sources > * {
  flex: 1;
  min-height: 0;
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
    width: 100vw;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }
  .settings-body {
    flex-direction: column;
  }
  .settings-nav {
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
  }
  .settings-search {
    flex: 0 0 132px;
    margin-bottom: 0;
  }
  .settings-nav-list {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .settings-nav-item {
    flex: 0 0 auto;
    width: auto;
  }
  .settings-nav-empty {
    display: none;
  }
  .settings-main-title {
    padding: var(--space-4) var(--space-4) var(--space-3);
  }
  .settings-scroll {
    padding: 0 var(--space-4) var(--space-6);
  }
  .settings-sources {
    padding: 0 var(--space-3) var(--space-3);
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
}

/* ── Amane 分区自带二级导航：在设置窗口内去掉它自己的卡片外观 ── */
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

.settings-scroll.settings-amane :deep(.amane-settings-nav .ui-nav-item) {
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

  .settings-scroll.settings-amane :deep(.amane-settings-nav .ui-nav-item) {
    flex: 0 0 auto;
    white-space: nowrap;
  }
}
</style>
