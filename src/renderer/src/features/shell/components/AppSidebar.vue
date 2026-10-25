<template>
  <aside
    class="app-sidebar yb-glass"
    :class="{ 'is-collapsed': collapsed, 'is-phone': isPhone }"
    aria-label="媒体中心导航"
  >
    <div class="sidebar-brand">
      <img class="brand-mark" :src="logoUrl" alt="" aria-hidden="true" />
      <span class="brand-name">{{ appName }}</span>
      <span v-if="incognito" class="sidebar-incognito" role="status">
        <UiIcon name="eyeOff" size="sm" />无痕
      </span>
      <UiIconButton
        class="sidebar-toggle"
        icon="panel"
        size="sm"
        :label="minimized ? '展开侧边栏' : '收起侧边栏'"
        @click="minimized = !minimized"
      />
    </div>
    <div class="sidebar-tools">
      <SidebarSearch :collapsed="collapsed" @expand="minimized = false" />
      <UiPressable
        v-if="assistantReady"
        v-tooltip.right="`AI 助手（${ASSISTANT_HOTKEY_LABEL}）`"
        class="sidebar-tool is-assistant"
        label="AI 助手"
        :aria-expanded="assistantOpen"
        @click="openAssistant"
      >
        <UiIcon name="sparkle" size="lg" />
      </UiPressable>
    </div>
    <nav class="sidebar-nav">
      <template v-for="group in navGroups" :key="group.key">
        <div v-if="group.divider" class="sidebar-divider" />
        <span v-if="group.heading" class="sidebar-heading">{{
          group.heading
        }}</span>
        <UiNavItem
          v-for="item in group.items"
          :key="item.path"
          class="sidebar-item"
          :label="navLabel(item)"
          :icon="item.icon"
          icon-size="lg"
          :active="item.active"
          :collapsed="collapsed"
          @click="emit('navigate', item.path)"
        >
          {{ item.label }}
          <template v-if="item.badge || isPathLocked(item.path)" #trailing>
            <span v-if="item.badge" class="sidebar-badge" aria-hidden="true">{{
              badgeText(item.badge)
            }}</span>
            <UiIcon
              v-if="isPathLocked(item.path)"
              name="lock"
              size="sm"
              class="sidebar-lock"
            />
          </template>
        </UiNavItem>
      </template>
    </nav>
    <div class="sidebar-footer">
      <UiNavItem
        class="sidebar-item"
        :label="incognito ? '关闭无痕模式' : '开启无痕模式'"
        current="pressed"
        :active="incognito"
        :collapsed="collapsed"
        @click="toggleIncognito"
      >
        <template #icon>
          <span class="footer-incognito-icon" aria-hidden="true">
            <UiIcon name="eyeOff" size="lg" />
            <span v-if="incognito" class="footer-dot" />
          </span>
        </template>
        无痕模式
      </UiNavItem>
      <UiNavItem
        class="sidebar-item"
        data-queue-anchor
        :label="queueLabel"
        current="pressed"
        :active="queueOpen"
        :collapsed="collapsed"
        @click="emit('toggle-queue')"
      >
        <template #icon>
          <span class="footer-queue-icon" aria-hidden="true">
            <UiIcon name="list" size="lg" />
            <span
              v-if="identifying"
              class="footer-ring"
              :style="{ '--ring-progress': identifying.progress ?? 0 }"
            />
            <span v-else-if="hasRuntime" class="footer-pulse" />
          </span>
        </template>
        后台任务
      </UiNavItem>
      <!-- 可见文字「设置」，无障碍名称「打开设置」，active 只是外观，不输出 aria-current -->
      <UiNavItem
        class="sidebar-item"
        label="设置"
        aria-label="打开设置"
        icon="settings"
        icon-size="lg"
        current="none"
        :active="settingsOpen"
        :collapsed="collapsed"
        @click="emit('open-settings')"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * 应用侧栏（浮动玻璃 .yb-glass，降低透明度时为实色）：品牌、全局搜索（SidebarSearch）与 AI 助手 sparkle 入口、
 * 分组导航、页脚的无痕模式开关（会话级，打开时品牌旁显示「无痕」标识、
 * 收起成图标栏时图标带圆点）、后台任务入口（运行时带提示：媒体库识别显示进度环，
 * 去码 / 边跑边看显示呼吸点）和设置入口。
 * 桌面端可收起为 64px 图标列（v-model:minimized；搜索与助手入口一组，悬停提示在右侧并带快捷键），
 * 手机上由外壳当作抽屉显示。
 */
import { computed } from 'vue'

import logoUrl from '@/assets/imgs/logo.svg'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import { vTooltip } from '@/components/ui/tooltip'
import { usePlatform } from '@/composables/use-platform'
import { aiAvailable } from '@/features/ai'
import {
  ASSISTANT_HOTKEY_LABEL,
  assistantOpen,
  openAssistant,
} from '@/features/assistant'
import { incognitoState, toggleIncognito } from '@/features/incognito'
import { useLadaTasks } from '@/features/lada'
import { useIdentifyActivity } from '@/features/library'
import { isPathLocked } from '@/features/section-lock'

import type { NavGroup, NavItem } from '../composables/nav-items'
import SidebarSearch from './SidebarSearch.vue'
import './app-sidebar.css'

defineProps<{
  /** 导航分组 */
  navGroups: NavGroup[]
  /** 实际是否以图标栏显示（手机上恒为 false） */
  collapsed: boolean
  /** 后台任务面板是否打开 */
  queueOpen: boolean
  /** 设置窗口是否打开 */
  settingsOpen: boolean
}>()
const emit = defineEmits<{
  navigate: [path: string]
  'toggle-queue': []
  'open-settings': []
}>()

/** 用户是否选择收起侧栏（v-model:minimized） */
const minimized = defineModel<boolean>('minimized', { required: true })

const appName = '影盒'
const { isPhone } = usePlatform()
const incognito = incognitoState()

/** AI 助手入口只在桌面端出现（AI 调用需要主进程） */
const assistantReady = aiAvailable()

// 去码 / 边跑边看在后台跑时，按钮上给个提示
const { hasRuntime } = useLadaTasks()
// 媒体库识别在跑时，按钮上显示进度环（进度条不再挤在各分区页面上）
const identifying = useIdentifyActivity()
/** 带角标的导航项：无障碍名称和收起时的悬停提示带上数字 */
const navLabel = (item: NavItem): string =>
  item.badge ? `${item.label}（${item.badge} 集未看）` : item.label
const badgeText = (count: number): string =>
  count > 99 ? '99+' : String(count)

const queueLabel = computed(() => {
  if (identifying.value) return `打开后台任务（${identifying.value.label}）`
  return hasRuntime.value ? '打开后台任务（进行中）' : '打开后台任务'
})
</script>
