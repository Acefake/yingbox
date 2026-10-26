<template>
  <div
    v-if="
      $slots.before ||
      $slots.after ||
      best.length ||
      moments.length ||
      actors.length
    "
    :id="listId"
    class="search-matches"
    role="listbox"
    aria-label="搜索结果"
  >
    <slot name="before" />
    <template v-if="best.length">
      <h3>本地片库</h3>
      <UiMediaRow
        v-for="(hit, index) in best"
        :id="`search-hit-${index}`"
        :key="hit.key"
        dense
        data-search-result
        role="option"
        :aria-selected="selected === index"
        :selected="selected === index"
        :title="hit.item.title"
        v-bind="hitRow(hit, infos.get(hit.item.id))"
        @open="emit('open', hit)"
      />
    </template>
    <template v-if="moments.length">
      <h3>画面时刻</h3>
      <UiListRow
        v-for="(hit, index) in moments"
        :id="`search-hit-${best.length + index}`"
        :key="`moment-${hit.key}`"
        data-search-result
        role="option"
        :aria-selected="selected === best.length + index"
        :selected="selected === best.length + index"
        @click="emit('moment', hit)"
      >
        <template #leading><UiIcon name="image" /></template
        >{{ hit.visual?.title }}
        <template #description
          >{{ hit.reasons.filter(reason => /画面/.test(reason)).join(' · ') }} ·
          点击从此处播放</template
        >
      </UiListRow>
    </template>
    <template v-if="actors.length">
      <h3>人物</h3>
      <UiListRow
        v-for="(actor, index) in actors"
        :id="`search-hit-${best.length + moments.length + index}`"
        :key="`actor-${actor.id}`"
        data-search-result
        role="option"
        :aria-selected="selected === best.length + moments.length + index"
        :selected="selected === best.length + moments.length + index"
        @click="emit('actor', actor.id)"
      >
        {{ actor.name
        }}<template #description>{{ actor.workCount }} 部库内作品</template>
      </UiListRow>
    </template>
    <slot name="after" />
  </div>
</template>
<script setup lang="ts">
/**
 * 有界结果列表，三类结果共享键盘索引（行 id 为 search-hit-<索引>）；行使用原生按钮，支持 Tab 和 Enter。
 * 作品行是影片结果行（UiMediaRow 紧凑行：海报、片名 · 年份、规格标签、评分、类型时长与命中理由），
 * 卡片信息在结果停下后按需取（useLibraryCardInfos）；画面时刻、人物是普通列表行。
 * before / after 插槽放在同一个 listbox 的最前 / 最后（统一入口的「问 AI」行与在线结果）。
 */
import type { ActorSummary } from '../../../../../shared/library/ipc'
import { UiIcon, UiListRow, UiMediaRow } from '@/components/ui'
import { useLibraryCardInfos } from '../detail/card-info'
import { hitRow } from './hit-row'
import type { SearchHit } from './types'
const props = defineProps<{
  best: SearchHit[]
  moments: SearchHit[]
  actors: ActorSummary[]
  selected: number
  /** listbox 的 id（输入框的 aria-controls 指向它） */
  listId: string
}>()
const emit = defineEmits<{
  open: [hit: SearchHit]
  moment: [hit: SearchHit]
  actor: [id: number]
}>()
const infos = useLibraryCardInfos(() => props.best.map(hit => hit.item.id))
</script>
<style scoped>
.search-matches h3 {
  margin: var(--space-3) var(--space-2) var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}
</style>
