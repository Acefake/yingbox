<template>
  <Teleport to="body">
    <div class="unified-search-backdrop" @click.self="emit('close')">
      <section
        ref="panel"
        class="unified-search"
        role="dialog"
        tabindex="-1"
        aria-modal="true"
        aria-label="搜索影盒"
        @keydown="onKeydown"
      >
        <header class="unified-search-bar">
          <UiInput
            ref="input"
            v-model="text"
            v-enter="submit"
            variant="filled"
            icon="search"
            clearable
            :placeholder="
              aiEnabled
                ? '搜影片，或说说你想看什么…'
                : '搜索片名、人物或描述画面…'
            "
            aria-label="搜索内容"
            :maxlength="500"
            role="combobox"
            :aria-expanded="entries.length > 0"
            :aria-controls="entries.length ? 'search-results' : undefined"
            :aria-activedescendant="
              selected >= 0 ? `search-hit-${selected}` : undefined
            "
          />
          <span>AI</span>
          <UiSwitch
            :model-value="aiEnabled"
            :disabled="privateOnly"
            label="AI 增强搜索"
            @update:model-value="value => (aiPreference = value)"
          />
          <UiIconButton icon="close" label="关闭搜索" @click="emit('close')" />
        </header>
        <div class="unified-search-tools">
          <UiSelect
            v-model="scope"
            aria-label="搜索范围"
            :disabled="privateOnly"
          >
            <option v-if="!privateOnly" value="all">本地片库</option>
            <option v-if="!privateOnly" value="movie">本地电影</option>
            <option v-if="!privateOnly" value="tv">本地剧集</option>
            <option v-if="privateOnly" value="jav">本地番号 · 仅本地</option>
          </UiSelect>
          <VisualSourceSelect v-if="scope === 'jav'" />
          <UiButton
            v-if="busy || thinking"
            size="sm"
            variant="plain"
            label="停止"
            @click="stop"
          />
          <UiButton
            v-else
            size="sm"
            variant="plain"
            :label="aiEnabled ? '搜索并用 AI 理解' : '搜索'"
            @click="run(aiEnabled)"
          />
        </div>
        <p class="unified-search-note">
          {{
            privateOnly
              ? '仅本地搜索，CLIP 画面不会上传。'
              : aiEnabled
                ? '回车后 AI 仅接收本次查询；本地结果先出。'
                : 'AI 已关闭，使用本地搜索。'
          }}
        </p>
        <SearchConditions
          :model-value="filter"
          :scope="scope"
          @update:model-value="value => run(false, value)"
        />
        <div class="unified-search-results custom-scrollbar">
          <SearchMatches
            :best="best"
            :moments="moments"
            :actors="shownActors"
            :selected="selected"
            @open="openHit"
            @moment="openMoment"
            @actor="openActor"
          />
          <p v-if="!text.trim()" class="unified-search-note">
            输入片名、演员、筛选条件或画面描述。↑ ↓ 选择结果，回车打开。
          </p>
          <p
            v-else-if="!busy && !thinking && !hits.length && !actors.length"
            class="unified-search-note"
          >
            没有找到匹配结果，可以调整条件或搜索在线资源。
          </p>
          <UiLoadingDots
            v-if="thinking"
            label="正在理解筛选条件，本地结果可继续使用…"
          />
          <UiLoadingDots v-else-if="busy" label="正在补充本地结果…" />
          <p v-if="message" class="unified-search-note" role="status">
            {{ message }}
          </p>
          <UiButton
            v-if="needsAiSetup"
            size="sm"
            variant="plain"
            label="去设置 AI"
            @click="settings"
          />
          <p v-if="visualNotice" class="unified-search-note">
            {{ visualNotice }}
          </p>
        </div>
        <footer class="unified-search-footer">
          <UiButton
            v-if="scope !== 'all'"
            size="sm"
            variant="plain"
            label="在海报墙查看"
            :disabled="!text.trim()"
            @click="wall"
          />
          <UiButton
            v-if="!privateOnly"
            size="sm"
            variant="plain"
            icon="search"
            label="搜索在线资源"
            :disabled="!text.trim()"
            @click="online"
          />
          <span class="unified-search-note">{{
            privateOnly
              ? '画面搜索使用已就绪的 CLIP 索引'
              : '⌘K / Ctrl+K 搜索 · AI 助手 ⌘⇧K / Ctrl+Shift+K'
          }}</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
/** 全局搜索面板：基础检索不依赖 AI；范围、焦点与取消生命周期绑定浮层。 */
import { useStorage } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  UiButton,
  UiIconButton,
  UiInput,
  UiLoadingDots,
  UiSelect,
  UiSwitch,
} from '@/components/ui'
import { isSearchCommand } from '@/utils/search-command'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useModalFocus } from '@/composables/use-focus-trap'
import { vEnter } from '@/directives/enter'
import { playMoment } from '../visual/play-moment'
import VisualSourceSelect from '../visual/VisualSourceSelect.vue'
import { visualSearchSource } from '../visual/visual-source'
import SearchConditions from './SearchConditions.vue'
import SearchMatches from './SearchMatches.vue'
import type { SearchHit, SearchScope } from './types'
import { useUnifiedSearch } from './use-unified-search'

const props = defineProps<{
  initialScope: SearchScope
  privateOnly: boolean
  command?: (text: string) => boolean
}>()
const text = defineModel<string>('text', { required: true })
const emit = defineEmits<{ close: [] }>()
const router = useRouter()
const scope = ref<SearchScope>(
  props.privateOnly
    ? 'jav'
    : props.initialScope === 'jav'
      ? 'all'
      : props.initialScope
)
const aiPreference = useStorage('yingbox.search.ai', false)
const aiEnabled = computed(
  () => aiPreference.value && !props.privateOnly && scope.value !== 'jav'
)
const input = ref<InstanceType<typeof UiInput> | null>(null)
const panel = ref<HTMLElement | null>(null)
const trapTab = useModalFocus(panel, () => true)
const selected = ref(-1)
const {
  hits,
  actors,
  filter,
  busy,
  thinking,
  message,
  visualNotice,
  needsAiSetup,
  run,
  stop,
} = useUnifiedSearch({
  text: () => text.value,
  scope: () => scope.value,
  open: () => true,
  ai: () => aiEnabled.value,
  visualSource: () => visualSearchSource.value,
})
const best = computed(() => hits.value.slice(0, 20))
const moments = computed(() =>
  hits.value.filter(hit => hit.visual?.frame).slice(0, 8)
)
const shownActors = computed(() => (scope.value === 'jav' ? actors.value : []))
const entries = computed(() => [
  ...best.value.map(hit => ({
    key: `work:${hit.key}`,
    open: () => openHit(hit),
  })),
  ...moments.value.map(hit => ({
    key: `moment:${hit.key}`,
    open: () => openMoment(hit),
  })),
  ...shownActors.value.map(actor => ({
    key: `actor:${actor.id}`,
    open: () => openActor(actor.id),
  })),
])
// 补入召回时保留当前选择的稳定键。
let selectedKey = ''
watch(entries, () => {
  selected.value = selectedKey
    ? entries.value.findIndex(entry => entry.key === selectedKey)
    : -1
})
watch(text, () => {
  selectedKey = ''
  selected.value = -1
})

function submit(): void {
  if (props.command?.(text.value.trim())) return
  const entry = entries.value[selected.value]
  if (entry) entry.open()
  else void run(aiEnabled.value)
}

function openHit(hit: SearchHit): void {
  const path =
    scope.value === 'jav'
      ? '/jav'
      : hit.item.type === 'series'
        ? '/tv'
        : '/movie'
  emit('close')
  void router.push({ path, query: { item: String(hit.item.id) } })
}

function openMoment(hit: SearchHit): void {
  const visual = hit.visual
  if (!visual?.frame) return
  emit('close')
  void playMoment(visual.itemId, visual.frame.fileId, visual.frame.at)
}

function openActor(id: number): void {
  if (scope.value !== 'jav') return
  emit('close')
  void router.push({ path: '/jav', query: { actor: String(id) } })
}

function wall(): void {
  if (isSearchCommand(text.value)) return
  emit('close')
  void router.push({
    path:
      scope.value === 'jav' ? '/jav' : scope.value === 'tv' ? '/tv' : '/movie',
    query: {
      q: text.value.trim(),
      searchFilter: JSON.stringify(
        Object.keys(filter.value).length
          ? filter.value
          : { keywords: [text.value.trim()] }
      ),
    },
  })
}

function online(): void {
  if (isSearchCommand(text.value)) return
  emit('close')
  void router.push({
    path: '/',
    query: { tab: 'search', q: text.value.trim() },
  })
}

function settings(): void {
  emit('close')
  window.dispatchEvent(new CustomEvent('app:open-settings', { detail: 'ai' }))
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return
  trapTab(event)
  if (
    (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
    event.target === panel.value?.querySelector('input')
  ) {
    event.preventDefault()
    const count = entries.value.length
    if (!count) return
    selected.value =
      selected.value < 0
        ? event.key === 'ArrowDown'
          ? 0
          : count - 1
        : (selected.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
    selectedKey = entries.value[selected.value].key
    document
      .getElementById(`search-hit-${selected.value}`)
      ?.scrollIntoView?.({ block: 'nearest' })
  }
}

useEscapeLayer(
  () => true,
  () => emit('close')
)
onMounted(async () => {
  await nextTick()
  input.value?.focus()
})
onBeforeUnmount(stop)
</script>
<style scoped src="./unified-search.css"></style>
