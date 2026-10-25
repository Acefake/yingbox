<template>
  <UiPressable
    v-if="collapsed"
    v-tooltip.right="`搜索（${shortcutLabel}）`"
    class="sidebar-tool"
    label="搜索"
    @click="expandAndFocus"
  >
    <UiIcon name="search" size="lg" />
  </UiPressable>
  <div v-else class="sidebar-search" role="search" :aria-label="placeholder">
    <UiInput
      ref="inputRef"
      v-model="text"
      v-enter="submit"
      class="sidebar-search-field"
      size="sm"
      clearable
      clear-label="清空搜索"
      :placeholder="placeholder"
      @clear="clear"
    >
      <template #leading><UiIcon name="search" size="md" /></template>
    </UiInput>
    <kbd v-if="!text && !isPhone" class="sidebar-kbd" aria-hidden="true">{{
      shortcutLabel
    }}</kbd>
  </div>
</template>

<script setup lang="ts">
/**
 * 侧栏里的全局搜索（Cmd/Ctrl + F 聚焦；Cmd/Ctrl + K 归 AI 助手）。
 * 搜索框与当前路由的 ?q= 同步；本地片库页（电影 / 剧集 / 番号）边输入边过滤（200ms 防抖），
 * 其余页面回车后跳到搜索标签。输入成人模式口令回车会切换成人模式。
 * 侧栏收起成图标列时只显示搜索图标：点它或按快捷键先展开侧栏（emit expand）再聚焦输入框。
 */
import { useDebounceFn } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UiIcon from '@/components/ui/UiIcon.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import { vTooltip } from '@/components/ui/tooltip'
import { usePlatform } from '@/composables/use-platform'
import { vEnter } from '@/directives/enter'
import { useSetting } from '@/features/settings'

import {
  ADULT_MODE_PASSPHRASE,
  filtersInPlace,
  isSearchShortcut,
  searchLocation,
  searchPlaceholder,
} from '../composables/global-search'

const props = defineProps<{
  /** 侧栏是否收起成图标列 */
  collapsed: boolean
}>()
const emit = defineEmits<{ expand: [] }>()

const router = useRouter()
const route = useRoute()
const { isPhone } = usePlatform()
const adultMode = useSetting('app.adultMode')

/** 键帽上的快捷键文字 */
const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform)
  ? '⌘ F'
  : 'Ctrl F'

const text = ref('')
const inputRef = ref<InstanceType<typeof UiInput> | null>(null)
/** 侧栏里有键帽提示，占位文字不再带快捷键 */
const placeholder = computed(() =>
  searchPlaceholder(route.name?.toString(), true)
)

watch(
  () => route.query.q,
  query => {
    text.value = typeof query === 'string' ? query : ''
  },
  { immediate: true }
)

// 本地片库页边输入边过滤：防抖后写回 ?q=（和路由里一样时不动，避免回环）
const applyInPlace = useDebounceFn((value: string) => {
  const name = route.name?.toString()
  if (!filtersInPlace(name)) return
  const query = value.trim()
  if (query.toLowerCase() === ADULT_MODE_PASSPHRASE) return
  const current = typeof route.query.q === 'string' ? route.query.q : ''
  if (query === current) return
  router.replace(searchLocation(name, route.path, query))
}, 200)
watch(text, value => {
  if (filtersInPlace(route.name?.toString())) void applyInPlace(value)
})

const submit = (): void => {
  const query = text.value.trim()
  if (query.toLowerCase() === ADULT_MODE_PASSPHRASE) {
    adultMode.value = !adultMode.value
    text.value = ''
    return
  }
  router.replace(searchLocation(route.name?.toString(), route.path, query))
}

const clear = (): void => {
  text.value = ''
  router.replace(searchLocation(route.name?.toString(), route.path, ''))
  nextTick(() => inputRef.value?.focus())
}

/** 收起时先展开侧栏，等输入框渲染出来再聚焦 */
const expandAndFocus = async (): Promise<void> => {
  if (props.collapsed) {
    emit('expand')
    await nextTick()
  }
  inputRef.value?.focus()
}

const onShortcut = (event: KeyboardEvent): void => {
  if (isSearchShortcut(event)) {
    event.preventDefault()
    void expandAndFocus()
  }
}
onMounted(() => window.addEventListener('keydown', onShortcut))
onUnmounted(() => window.removeEventListener('keydown', onShortcut))
</script>

<style scoped>
.sidebar-search {
  position: relative;
  flex: 1;
  min-width: 0;
}
.sidebar-search-field {
  height: 36px;
  padding: 0 var(--space-2) 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-full);
  background: var(--bg-glass-hover);
  box-shadow: inset 0 0 0 0.5px var(--border-glass);
  font-size: var(--text-sm);
}
.sidebar-search-field:focus-within {
  box-shadow: var(--focus-ring);
}
.sidebar-search-field :deep(.ui-input-clear) {
  --ib-size: 24px;
}
.sidebar-kbd {
  position: absolute;
  top: 50%;
  right: var(--space-2);
  padding: 1px var(--space-1_5);
  border: 0.5px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-family: inherit;
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
  line-height: 1.4;
  transform: translateY(-50%);
  pointer-events: none;
}
</style>
