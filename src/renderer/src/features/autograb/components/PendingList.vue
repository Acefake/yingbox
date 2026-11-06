<template>
  <section class="ag-section" aria-labelledby="ag-pending-title">
    <div class="ag-section-head">
      <h3 id="ag-pending-title" class="ag-section-title">
        需要你处理<span class="ag-section-count">{{ groups.length }} 部</span>
      </h3>
      <UiButton
        v-if="groups.length > 1 && grabbable.length"
        class="ag-section-action"
        size="sm"
        variant="plain"
        icon="download"
        :label="`全部转存缺集（${grabbable.length} 集）`"
        :loading="grabbingAll"
        @click="
          emit(
            'grab-best',
            grabbable.map(ep => ep.key)
          )
        "
      />
    </div>
    <ul class="ag-tasks">
      <li v-for="group in groups" :key="group.id">
        <GrabTaskCard
          :title="series.get(group.id)?.title ?? group.episodes[0].seriesTitle"
          :subtitle="`${group.episodes.length} 集待处理 · ${group.ready.length} 集可转存`"
          :poster="libraryImage(posters.get(group.id) ?? null, 300)"
          :state="packState(group.id, group.ready.length)"
          :tone="group.ready.length ? 'pending' : 'problem'"
          :reason="
            group.ready.length
              ? '优先匹配合集，只转存本剧缺集；其余缺集继续搜索。'
              : '暂未找到可转存的缺集资源，可在追剧详情查看搜索状态。'
          "
        >
          <p v-if="group.shares.length" class="ag-pack-titles">
            {{ group.shares.join('；') }}
          </p>
          <template #actions>
            <UiButton
              size="sm"
              variant="plain"
              label="追剧详情"
              @click="emit('open-series', group.id)"
            />
            <UiButton
              size="sm"
              variant="plain"
              label="取消追剧"
              :loading="stopping.has(group.id)"
              @click="emit('stop', group.id)"
            />
            <UiButton
              v-if="group.ready.length"
              size="sm"
              variant="primary"
              icon="download"
              :label="`转存本剧缺集（${group.ready.length} 集）`"
              :loading="group.episodes.some(ep => busy.has(ep.key))"
              :disabled="stopping.has(group.id) || grabbingAll"
              @click="
                emit(
                  'grab-best',
                  group.ready.map(ep => ep.key)
                )
              "
            />
          </template>
        </GrabTaskCard>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/** 待处理内容按剧汇总；分集候选和跳过操作收在追剧详情。 */
import { computed } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import { libraryImage } from '@/features/library'
import type {
  AutograbEpisode,
  AutograbPackSearch,
  AutograbSeries,
} from '../../../../../shared/contract/autograb'
import type { EpisodeAction } from '../use-autograb'
import GrabTaskCard from './GrabTaskCard.vue'

const props = defineProps<{
  episodes: AutograbEpisode[]
  busy: ReadonlyMap<string, EpisodeAction>
  posters: ReadonlyMap<number, string | null>
  series: ReadonlyMap<number, AutograbSeries>
  grabbingAll: boolean
  stopping: ReadonlySet<number>
  packSearch?: AutograbPackSearch[]
}>()
const emit = defineEmits<{
  'grab-best': [keys: string[]]
  'open-series': [seriesId: number]
  stop: [seriesId: number]
}>()

const grabbable = computed(() =>
  props.episodes.filter(
    ep =>
      (ep.status === 'found' || ep.status === 'noSpace') &&
      ep.candidates.length &&
      !props.stopping.has(ep.seriesId)
  )
)
const groups = computed(() => {
  const map = new Map<number, AutograbEpisode[]>()
  for (const ep of props.episodes) {
    const group = map.get(ep.seriesId) ?? []
    group.push(ep)
    map.set(ep.seriesId, group)
  }
  return [...map].map(([id, episodes]) => {
    const ready = grabbable.value.filter(ep => ep.seriesId === id)
    return {
      id,
      episodes,
      ready,
      shares: [
        ...new Set(
          ready.map(ep => ep.candidates[0].shareTitle).filter(Boolean)
        ),
      ],
    }
  })
})

function packState(id: number, ready: number): string {
  const pack = props.packSearch?.find(item => item.seriesId === id)
  if (pack?.status === 'searching') return '正在查找合集'
  if (pack?.status === 'complete' && pack.matched)
    return `合集已匹配 ${pack.matched} 集`
  return ready ? '缺集资源待转存' : '缺集资源未找到'
}
</script>

<style scoped src="./autograb-view.css"></style>
<style scoped>
.ag-pack-titles {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
</style>
