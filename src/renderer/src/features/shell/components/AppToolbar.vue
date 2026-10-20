<template>
  <header class="top-menu" :class="{ 'is-phone': isPhone }">
    <div class="menu-content">
      <div class="toolbar-leading">
        <UiIconButton
          v-if="isPhone"
          icon="menu"
          label="打开菜单"
          @click="emit('open-menu')"
        />
        <UiIconButton icon="back" label="后退" @click="navigateBack" />
        <UiIconButton
          v-if="!isPhone"
          icon="forward"
          label="前进"
          @click="router.forward()"
        />
        <UiIconButton
          v-if="!isPhone"
          icon="refresh"
          label="刷新"
          @click="router.go(0)"
        />
        <div
          class="global-search"
          role="search"
          :aria-label="globalSearchPlaceholder"
        >
          <UiInput
            ref="globalSearchInput"
            v-model="globalSearch"
            class="global-search-field"
            variant="filled"
            clearable
            clear-label="清空搜索"
            :placeholder="globalSearchPlaceholder"
            @keydown.enter.prevent="submitGlobalSearch"
            @clear="clearGlobalSearch"
          >
            <template #leading><UiIcon name="search" size="md" /></template>
          </UiInput>
        </div>
      </div>

      <!-- 右侧：窗口控制 -->
      <div class="window-section">
        <WinControls :show-window-buttons="isElectron" />
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * 顶部工具栏：前进 / 后退 / 刷新、全局搜索（Ctrl + K 聚焦）和窗口控制，整条保留窗口拖拽区域。
 * 搜索框与当前路由的 ?q= 同步；输入成人模式口令回车会切换成人模式。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { usePlatform } from '@/composables/use-platform'
import { useSetting } from '@/features/settings'

import {
  ADULT_MODE_PASSPHRASE,
  searchLocation,
  searchPlaceholder,
} from '../composables/global-search'
import WinControls from './WinControls.vue'

const emit = defineEmits<{ 'open-menu': [] }>()

const router = useRouter()
const route = useRoute()
const { isElectron, isPhone } = usePlatform()
const adultMode = useSetting('app.adultMode')

const globalSearch = ref('')
const globalSearchInput = ref<InstanceType<typeof UiInput> | null>(null)
const globalSearchPlaceholder = computed(() =>
  searchPlaceholder(route.name?.toString(), isPhone.value)
)

watch(
  () => route.query.q,
  query => {
    globalSearch.value = typeof query === 'string' ? query : ''
  },
  { immediate: true }
)

/** 后退前先广播 app:navigate-back，页面可 preventDefault 自己处理（如关闭详情层） */
const navigateBack = (): void => {
  const event = new CustomEvent('app:navigate-back', { cancelable: true })
  window.dispatchEvent(event)
  if (!event.defaultPrevented) router.back()
}

const submitGlobalSearch = (): void => {
  const query = globalSearch.value.trim()
  if (query.toLowerCase() === ADULT_MODE_PASSPHRASE) {
    adultMode.value = !adultMode.value
    globalSearch.value = ''
    return
  }
  router.replace(searchLocation(route.name?.toString(), route.path, query))
}

const clearGlobalSearch = (): void => {
  globalSearch.value = ''
  router.replace(searchLocation(route.name?.toString(), route.path, ''))
  nextTick(() => globalSearchInput.value?.focus())
}

const onGlobalSearchShortcut = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    globalSearchInput.value?.focus()
  }
}
onMounted(() => window.addEventListener('keydown', onGlobalSearchShortcut))
onUnmounted(() => window.removeEventListener('keydown', onGlobalSearchShortcut))
</script>

<style scoped>
/* 标题栏与内容同色，不留色带 */
.top-menu {
  position: relative;
  z-index: 5;
  flex: 0 0 var(--titlebar-height);
  height: var(--titlebar-height);
  background: var(--bg-content);
  -webkit-app-region: drag;
}
.menu-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: 100%;
  padding: 0 var(--space-4) 0 var(--space-3);
}
.toolbar-leading {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  -webkit-app-region: no-drag;
}
.window-section {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  -webkit-app-region: no-drag;
}

.global-search {
  display: flex;
  width: min(320px, 32vw);
  margin-left: var(--space-2);
}
.global-search-field {
  padding: 0 var(--space-1) 0 var(--space-3);
}
.global-search-field :deep(.ui-input-clear) {
  --ib-size: 24px;
}

.top-menu.is-phone .menu-content {
  padding: 0 var(--space-2);
}
.top-menu.is-phone .global-search {
  flex: 1;
  width: auto;
  min-width: 0;
  margin-left: var(--space-1);
}
</style>
