<template>
  <div class="nas-layout" :class="{ 'is-phone': isPhone }">
    <aside
      v-if="!isPhone"
      class="nas-sidebar yb-glass"
      aria-label="媒体中心导航"
    >
      <div class="nas-brand">
        <UiBrandLogo :color="brandColor" /><UiBrandWordmark
          :color="brandColor"
        />
      </div>
      <LibrarySearch class="nas-search" />
      <nav aria-label="媒体中心导航分组">
        <template v-for="group in navGroups" :key="group.key">
          <span v-if="group.heading" class="nas-sidebar-heading">{{
            group.heading
          }}</span>
          <UiNavItem
            v-for="item in group.items"
            :key="item.path"
            :label="navLabel(item)"
            :icon="item.icon"
            :active="item.active"
            @click="router.push(item.path)"
          >
            {{ item.label }}
            <template v-if="item.badge" #trailing>
              <span class="nas-sidebar-badge" aria-hidden="true">{{
                badgeText(item.badge)
              }}</span>
            </template>
          </UiNavItem>
        </template>
      </nav>
      <div class="nas-sidebar-footer">
        <UiNavItem
          label="片库任务"
          icon="list"
          :active="route.path === '/tasks'"
          @click="router.push('/tasks')"
        />
        <UiNavItem
          label="设置"
          aria-label="打开设置"
          icon="settings"
          current="none"
          :active="settingsVisible"
          @click="openSettings()"
        />
      </div>
    </aside>
    <header v-else class="nas-mobile-header">
      <div class="nas-mobile-top">
        <span>影盒</span>
        <div class="nas-header-actions">
          <UiIconButton
            icon="list"
            label="片库任务"
            @click="router.push('/tasks')"
          />
          <UiIconButton
            icon="settings"
            label="打开设置"
            @click="openSettings()"
          />
        </div>
      </div>
      <LibrarySearch />
    </header>
    <main class="nas-content">
      <ServerConnect v-if="serverState !== 'online'" :state="serverState" />
      <slot v-else />
    </main>
    <nav v-if="isPhone" class="nas-bottom-nav" aria-label="主导航">
      <UiNavItem
        v-for="item in flatItems"
        :key="item.path"
        layout="stack"
        :label="item.label"
        :icon="item.icon"
        :active="item.active"
        @click="router.push(item.path)"
      />
    </nav>
    <SettingsPanel
      :visible="settingsVisible"
      :initial-section="settingsSection"
      @close="settingsVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
/** 复用影盒的浮动侧栏、导航控件与设置面板，手机上使用底部导航。 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import UiBrandLogo from '@/components/ui/UiBrandLogo.vue'
import UiBrandWordmark from '@/components/ui/UiBrandWordmark.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { usePlatform } from '@/composables/use-platform'
import { autograbAvailable, useAutograbBadge } from '@/features/autograb'
import { useCalendarBadge } from '@/features/calendar'
import { useLocalNavPages } from '@/features/library'
import { netdiskAvailable } from '@/features/netdisk'
import { SettingsPanel, useSetting } from '@/features/settings'
import {
  type NavGroup,
  type NavItem,
  type NavState,
  buildNavGroups,
} from '@/features/shell/composables/nav-items'
import { libraryServerState } from '@/services/library-server'
import ServerConnect from '@/features/shell/components/ServerConnect.vue'
import LibrarySearch from './LibrarySearch.vue'
import './layout.css'

const { isPhone, hasLocalLibrary } = usePlatform()
const route = useRoute()
const router = useRouter()
const serverState = libraryServerState()
const brandColor = useSetting('ui.brandColor')
const settingsVisible = ref(false)
const settingsSection = ref('library')
const localPages = useLocalNavPages()
const calendarBadge = useCalendarBadge()
const autograbBadge = useAutograbBadge()
// 与桌面侧栏同一份导航（features/shell/composables/nav-items.ts）；NAS 构建始终关闭成人模式
const navState = computed<NavState>(() => ({
  routeName: route.name?.toString(),
  onlineTab: typeof route.query.tab === 'string' ? route.query.tab : undefined,
  hasLocalLibrary: hasLocalLibrary.value,
  hasNetdisk: netdiskAvailable,
  adultMode: false,
  calendarBadge: calendarBadge.value,
  hasAutograb: autograbAvailable,
  autograbBadge: autograbBadge.value,
  localPages: localPages.value,
}))
const navGroups = computed((): NavGroup[] => buildNavGroups(navState.value))
const flatItems = computed((): NavItem[] =>
  navGroups.value.flatMap(group => group.items)
)

function navLabel(item: NavItem): string {
  return item.badge ? `${item.label}（${item.badge} 集未看）` : item.label
}

function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count)
}

function openSettings(section = 'library'): void {
  settingsSection.value = section
  settingsVisible.value = true
}

function onSettings(event: Event): void {
  const detail: unknown = (event as CustomEvent).detail
  openSettings(typeof detail === 'string' ? detail : 'library')
}

onMounted(() => window.addEventListener('app:open-settings', onSettings))
onUnmounted(() => window.removeEventListener('app:open-settings', onSettings))
</script>
