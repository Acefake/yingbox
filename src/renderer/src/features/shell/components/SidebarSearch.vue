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
      @click="searchOpen = !isSearchCommand(text)"
      @input="searchOpen = !isSearchCommand(text)"
    >
      <template #leading><UiIcon name="search" size="md" /></template>
    </UiInput>
    <kbd v-if="!text && !isPhone" class="sidebar-kbd" aria-hidden="true">{{
      shortcutLabel
    }}</kbd>
  </div>
  <UnifiedSearchPanel
    v-if="searchOpen"
    v-model:text="text"
    :initial-scope="searchScope"
    :private-only="privateSearch"
    :command="runCommand"
    @close="searchOpen = false"
  />
</template>

<script setup lang="ts">
/**
 * 侧栏里的统一搜索入口（Cmd/Ctrl + K 或 F）。
 * 读取路由里的搜索词，打开统一面板并行查询片名、人物、条件和就绪的 CLIP 索引。
 * 侧栏收起成图标列时只显示搜索图标：点它或按快捷键先展开侧栏（emit expand）再聚焦输入框。
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import UiIcon from '@/components/ui/UiIcon.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import { vTooltip } from '@/components/ui/tooltip'
import { usePlatform } from '@/composables/use-platform'
import { vEnter } from '@/directives/enter'
import { isSearchCommand } from '@/utils/search-command'
import { useSetting } from '@/features/settings'
import { UnifiedSearchPanel } from '@/features/library'
import { playerModal } from '@/features/player'

import {
  ADULT_MODE_PASSPHRASE,
  isSearchShortcut,
  searchPlaceholder,
} from '../composables/global-search'

const props = defineProps<{
  /** 侧栏是否收起成图标列 */
  collapsed: boolean
}>()
const emit = defineEmits<{ expand: [] }>()

const route = useRoute()
const router = useRouter()
const { isPhone } = usePlatform()
const adultMode = useSetting('app.adultMode')

/** 键帽上的快捷键文字 */
const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform)
  ? '⌘ K'
  : 'Ctrl K'

const text = ref('')
const searchOpen = ref(false)
const player = playerModal()
const privateSearch = computed(
  () =>
    ['Jav', 'AV'].includes(route.name?.toString() ?? '') ||
    player.value?.payload.private === true
)
const searchScope = computed(() =>
  privateSearch.value
    ? 'jav'
    : route.name === 'Movie'
      ? 'movie'
      : route.name === 'TV'
        ? 'tv'
        : 'all'
)
watch([() => route.fullPath, privateSearch], () => {
  searchOpen.value = false
})
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

function runCommand(query: string): boolean {
  if (query.toLowerCase() !== ADULT_MODE_PASSPHRASE) return false
  adultMode.value = !adultMode.value
  text.value = ''
  searchOpen.value = false
  return true
}

const submit = (): void => {
  if (!runCommand(text.value.trim())) searchOpen.value = true
}

const clear = (): void => {
  text.value = ''
  void router.replace({
    path: route.path,
    query: { ...route.query, q: undefined, searchFilter: undefined },
  })
  nextTick(() => inputRef.value?.focus())
}

/** 收起时先展开侧栏，等输入框渲染出来再聚焦 */
const expandAndFocus = async (): Promise<void> => {
  if (props.collapsed) {
    emit('expand')
    await nextTick()
  }
  searchOpen.value = true
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
