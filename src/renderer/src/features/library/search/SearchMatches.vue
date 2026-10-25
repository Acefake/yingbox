<template>
  <div
    v-if="best.length || moments.length || actors.length"
    id="search-results"
    class="search-matches"
    role="listbox"
    aria-label="搜索结果"
  >
    <template v-if="best.length">
      <h3>最佳匹配</h3>
      <UiListRow
        v-for="(hit, index) in best"
        :id="`search-hit-${index}`"
        :key="hit.key"
        data-search-result
        role="option"
        :aria-selected="selected === index"
        :selected="selected === index"
        @click="emit('open', hit)"
      >
        <template #leading
          ><img
            v-if="hit.item.poster"
            class="search-poster"
            :src="libraryPoster(hit.item.poster) ?? undefined"
            alt=""
            loading="lazy"
        /></template>
        {{ hit.item.title }}
        <span v-if="hit.item.year"> · {{ hit.item.year }}</span>
        <template #description
          >{{ hit.reasons.join(' · ')
          }}{{
            hit.versions.length > 1 ? ` · ${hit.versions.length} 个版本` : ''
          }}</template
        >
      </UiListRow>
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
  </div>
</template>
<script setup lang="ts">
/** 有界结果列表，三类结果共享键盘索引；行使用原生按钮，支持 Tab 和 Enter。 */
import type { ActorSummary } from '../../../../../shared/library/ipc'
import { UiIcon, UiListRow } from '@/components/ui'
import { libraryPoster } from '../detail/assistant-links'
import type { SearchHit } from './types'
defineProps<{
  best: SearchHit[]
  moments: SearchHit[]
  actors: ActorSummary[]
  selected: number
}>()
const emit = defineEmits<{
  open: [hit: SearchHit]
  moment: [hit: SearchHit]
  actor: [id: number]
}>()
</script>
<style scoped>
.search-matches h3 {
  margin: var(--space-3) var(--space-2) var(--space-1);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}
.search-poster {
  width: 30px;
  height: 44px;
  object-fit: cover;
  border-radius: var(--radius-sm);
}
</style>
