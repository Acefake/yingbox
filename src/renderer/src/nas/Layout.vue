<template>
  <div class="nas-layout" :class="{ 'is-phone': isPhone }">
    <aside
      v-if="!isPhone"
      class="nas-sidebar yb-glass"
      aria-label="媒体中心导航"
    >
      <div class="nas-brand"><img :src="logo" alt="" /><span>影盒</span></div>
      <LibrarySearch class="nas-search" />
      <nav aria-label="片库与网盘">
        <UiNavItem
          v-for="item in items"
          :key="item.path"
          :label="item.label"
          :icon="item.icon"
          :active="route.path === item.path"
          @click="router.push(item.path)"
        />
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
        v-for="item in items"
        :key="item.path"
        layout="stack"
        :label="item.label"
        :icon="item.icon"
        :active="route.path === item.path"
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
import logo from '@/assets/imgs/logo.svg'
import UiNavItem from '@/components/ui/UiNavItem.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import type { IconName } from '@/components/ui/icons'
import { usePlatform } from '@/composables/use-platform'
import { SettingsPanel, useSetting } from '@/features/settings'
import { libraryServerState } from '@/services/library-server'
import ServerConnect from '@/features/shell/components/ServerConnect.vue'
import LibrarySearch from './LibrarySearch.vue'
import './layout.css'

const { isPhone } = usePlatform()
const route = useRoute()
const router = useRouter()
const serverState = libraryServerState()
const adult = useSetting('app.adultMode')
const settingsVisible = ref(false)
const settingsSection = ref('library')
const items = computed(
  (): Array<{ path: string; label: string; icon: IconName }> => [
    { path: '/', label: '首页', icon: 'home' },
    { path: '/movie', label: '电影', icon: 'movie' },
    { path: '/tv', label: '剧集', icon: 'tv' },
    ...(adult.value
      ? [{ path: '/jav', label: '番号', icon: 'tag' as const }]
      : []),
    { path: '/netdisk', label: '网盘', icon: 'cloud' },
    { path: '/autograb', label: '自动追更', icon: 'refresh' },
  ]
)

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
