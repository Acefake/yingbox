<template>
  <aside
    class="app-sidebar yb-glass"
    :class="{
      'is-collapsed': collapsed,
      'is-phone': isPhone,
    }"
    aria-label="媒体中心导航"
  >
    <div class="sidebar-brand">
      <img class="brand-mark" :src="logoUrl" alt="" aria-hidden="true" />
      <span class="brand-name">{{ appName }}</span>
      <span v-if="incognito" class="sidebar-incognito" role="status">
        <UiIcon name="eyeOff" size="sm" />无痕
      </span>
      <UiIconButton
        v-tooltip.right="
          `${minimized ? '展开' : '收起'}侧边栏（${SIDEBAR_HOTKEY_LABEL}）`
        "
        class="sidebar-toggle"
        icon="panel"
        :size="collapsed ? 'lg' : 'sm'"
        :label="minimized ? '展开侧边栏' : '收起侧边栏'"
        @click="minimized = !minimized"
      />
    </div>
    <div class="sidebar-tools">
      <SidebarSearch :collapsed="collapsed" />
    </div>
    <nav class="sidebar-nav">
      <template v-for="(group, index) in navGroups" :key="group.key">
        <div
          v-if="group.divider || (collapsed && index > 0)"
          class="sidebar-divider"
        />
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
      <div class="sidebar-divider" />
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
          </span>
        </template>
        后台任务
        <template v-if="runningCount" #trailing>
          <span class="sidebar-badge" aria-hidden="true">{{
            runningCount
          }}</span>
        </template>
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
 * 应用侧栏（浮动玻璃 .yb-glass，降低透明度时为实色）：品牌行（彩色 Logo + 收起钮）、
 * 统一入口（SidebarSearch：看起来是搜索框，点它或 Cmd/Ctrl+K 打开搜索与 AI 助手共用的居中浮层）、
 * 分组导航（资料库 / 本地媒体 / 在线），贴在侧栏底部的页脚：无痕模式开关（会话级，打开时品牌旁显示「无痕」标识、
 * 收起成图标栏时图标带圆点）、后台任务入口（正在跑的任务数角标，媒体库识别另带进度环）和设置入口。
 * 桌面端可收起为 64px 图标列（v-model:minimized，外壳负责 Cmd/Ctrl+B 与持久化）：组间用分隔线，
 * 统一入口收成放大镜圆钮，悬停提示在右侧并带快捷键。手机上由外壳当作抽屉显示。
 */
import { computed } from 'vue'

import logoUrl from '@/assets/imgs/logo.svg'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'
import { vTooltip } from '@/components/ui/tooltip'
import { usePlatform } from '@/composables/use-platform'
import { incognitoState, toggleIncognito } from '@/features/incognito'
import { useLadaTasks } from '@/features/lada'
import { useIdentifyActivity } from '@/features/library'
import { isPathLocked } from '@/features/section-lock'

import type { NavGroup, NavItem } from '../composables/nav-items'
import { SIDEBAR_HOTKEY_LABEL } from '../composables/sidebar-state'
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

// 去码 / 边跑边看在后台跑时，按钮上给个提示
const { hasRuntime, restoreRunning, hasLive } = useLadaTasks()
// 媒体库识别在跑时，按钮上显示进度环（进度条不再挤在各分区页面上）
const identifying = useIdentifyActivity()
/** 带角标的导航项：无障碍名称和收起时的悬停提示带上数字 */
const navLabel = (item: NavItem): string =>
  item.badge ? `${item.label}（${item.badge} 集未看）` : item.label
const badgeText = (count: number): string =>
  count > 99 ? '99+' : String(count)

/** 后台任务入口的数字角标：正在跑的任务数（识别 / 去码 / 边跑边看） */
const runningCount = computed(
  () =>
    Number(Boolean(identifying.value)) +
    Number(restoreRunning.value) +
    Number(hasLive.value)
)

const queueLabel = computed(() => {
  if (identifying.value) return `打开后台任务（${identifying.value.label}）`
  return hasRuntime.value ? '打开后台任务（进行中）' : '打开后台任务'
})
</script>
