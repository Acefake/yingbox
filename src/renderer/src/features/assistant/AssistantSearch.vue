<template>
  <div class="assistant-search" :class="{ 'yb-glass': floating }">
    <div
      v-if="entry.chips.value.length"
      class="assistant-scopes"
      role="radiogroup"
      aria-label="搜索范围"
    >
      <UiChip
        v-for="chip in entry.chips.value"
        :key="chip.id"
        role="radio"
        :aria-checked="entry.scope.value === chip.id"
        :selected="entry.scope.value === chip.id"
        :label="chip.label"
        @click="entry.pickScope(chip.id)"
      />
    </div>
    <div class="assistant-search-list">
      <SearchMatches
        list-id="entry-results"
        :best="local ? search.best.value : []"
        :moments="local ? search.moments.value : []"
        :actors="local ? search.actors.value : []"
        :selected="selected"
        @open="search.openHit"
        @moment="search.openMoment"
        @actor="search.openActor"
      >
        <template v-if="askable" #before>
          <UiListRow
            id="entry-ask"
            class="assistant-ask"
            role="option"
            :aria-selected="selected === ASK_ROW"
            :selected="selected === ASK_ROW"
            @click="emit('ask')"
          >
            <template #leading><UiIcon name="sparkle" /></template>
            问 AI：<span class="assistant-ask-text">{{
              entry.query.value
            }}</span>
            <template #description>{{ askNote }}</template>
            <template #trailing>
              <kbd class="assistant-kbd" aria-hidden="true">{{ askKey }}</kbd>
            </template>
          </UiListRow>
        </template>
        <template v-if="online.rows.value.length" #after>
          <h3>在线影视源</h3>
          <UiListRow
            v-for="(row, index) in online.rows.value"
            :id="`search-hit-${localCount + index}`"
            :key="row.key"
            data-search-result
            role="option"
            :aria-selected="selected === localCount + index"
            :selected="selected === localCount + index"
            @click="online.open(row)"
          >
            <template #leading>
              <img
                v-if="row.cover"
                class="search-poster"
                :src="row.cover"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
              />
              <UiIcon v-else class="assistant-online-icon" name="globe" />
            </template>
            {{ row.title }}<span v-if="row.year"> · {{ row.year }}</span>
            <template #description>{{ onlineNote(row) }}</template>
          </UiListRow>
        </template>
      </SearchMatches>
    </div>
    <footer class="assistant-search-foot">
      <span class="assistant-search-note" role="status">{{ note }}</span>
      <VisualSourceSelect v-if="local && search.canPickVisual.value" />
      <UiButton
        v-if="local && search.canWall.value"
        size="sm"
        variant="plain"
        label="在海报墙查看"
        @click="search.wall"
      />
      <UiButton
        v-if="search.canOnline.value && entry.chips.value.length"
        size="sm"
        variant="plain"
        icon="globe"
        label="在线搜索页"
        @click="search.online"
      />
    </footer>
  </div>
</template>

<script setup lang="ts">
/**
 * 统一入口里的搜索结果块。最上一排范围胶囊（全部 / 本地 / 在线 / 当前分区；私密模式没有）；
 * 下面一个 listbox：「问 AI：<输入>」一行（能问 AI 时）→ 本地片库结果（海报行，本地召回与 AI 增强融合去重，
 * 理由里写「AI 理解 · …」；画面时刻、人物也在这里，SearchMatches 来自片库 feature）→ 在线影视源（异步追加，
 * 同名同年多源合成一行）。底部一行是状态（读屏会播报：条数、AI 正在理解、在线源还在追加、没找到…）和去向：
 * CLIP 范围选择（私密范围）、在海报墙查看（当前分区）、在线搜索页（完整的在线结果）。
 * 空闲（hero）时是输入胶囊下面一块独立的玻璃（floating），面板里是输入框上方的一段。
 * 键盘选中由浮层管（assistant-entry.ts），这里只显示。
 */
import { computed } from 'vue'

import { UiButton, UiChip, UiIcon, UiListRow } from '@/components/ui'

import { ASK_HOTKEY_LABEL as askKey } from './assistant-hotkey'
import { ASK_ROW } from './assistant-entry'
import { librarySearchModule } from './library-search'
import type { OnlineRow } from './use-entry-online'
import type { EntrySearch } from './use-entry-search'

const props = defineProps<{
  entry: EntrySearch
  selected: number
  /** 有没有「问 AI」行（网页版没有） */
  askable: boolean
  /** AI 已配置到能发请求 */
  aiReady: boolean
  /** 私密模式（问 AI 只用本地模型） */
  private: boolean
  /** 独立的玻璃块（空闲时） */
  floating?: boolean
}>()
const emit = defineEmits<{ ask: [] }>()

const { SearchMatches, VisualSourceSelect } = librarySearchModule()

const search = computed(() => props.entry.search)
const online = computed(() => props.entry.online)
/** 范围包含本地 */
const local = computed(
  () => props.private || props.entry.scope.value !== 'online'
)
const localCount = computed(() =>
  local.value ? search.value.entries.value.length : 0
)

const askNote = computed(() => {
  if (!props.aiReady) return '还没有配置 AI，回车后可去设置；搜索不受影响'
  return props.private ? '仅本地模型 · 无痕' : '和 AI 对话'
})

function onlineNote(row: OnlineRow): string {
  const [first] = row.sources
  if (!first) return '在线'
  return row.sources.length > 1
    ? `在线 · ${first} 等 ${row.sources.length} 个源`
    : `在线 · ${first}`
}

const note = computed(() => {
  const count = props.entry.entries.value.length
  const parts: string[] = []
  const message = local.value ? search.value.message.value : ''
  if (message) parts.push(message)
  if (local.value && search.value.thinking.value) parts.push('AI 正在理解…')
  if (online.value.busy.value) parts.push('在线源搜索中…')
  const visual = local.value ? search.value.visualNotice.value : ''
  if (visual) parts.push(visual)
  const pending =
    (local.value && search.value.busy.value) || online.value.busy.value
  if (count) parts.unshift(`${count} 个结果`)
  else if (!pending && !message) parts.unshift('没有找到匹配的内容')
  else if (!message) parts.unshift('正在搜索…')
  return parts.join(' · ')
})
</script>
