<template>
  <section>
    <PageHeader :title="title" as="h2" />
    <slot name="controls" />
    <UiVirtualGrid
      v-if="items.length"
      :items="items"
      class="ui-poster-grid is-landscape"
      :item-key="video => video._uid"
    >
      <template #default="{ item: video }">
        <UiPosterCard
          thumb
          shape="landscape"
          :title="video.vod_name ?? ''"
          :cover="coverSrc(video)"
          :subtitle="video._source"
          :favorite="isFavorite(video)"
          @open="emit('play', video)"
          @toggle-favorite="emit('toggle-favorite', video)"
        >
          <template #actions>
            <slot name="actions" :video="video" />
          </template>
        </UiPosterCard>
      </template>
    </UiVirtualGrid>
    <StatusState v-else icon="bookmark" :title="emptyTitle" />
  </section>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import StatusState from '@/components/StatusState.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import type { AvVideo } from '../utils/av-catalog'
import { coverSrc } from '../utils/av-media'

defineSlots<{
  /** 列表顶部的操作区。 */
  controls(): unknown
  /** 资源卡片上的列表操作。 */
  actions(props: { video: AvVideo }): unknown
}>()

withDefaults(
  defineProps<{
    /** 列表中的资源，按加入顺序排列。 */
    items: AvVideo[]
    /** 当前列表的标题。 */
    title?: string
    /** 列表为空时的提示。 */
    emptyTitle?: string
    /** 查询卡片的收藏状态。 */
    isFavorite: (video: AvVideo) => boolean
  }>(),
  {
    title: '待看',
    emptyTitle: '还没有待看的资源',
  }
)
const emit = defineEmits<{
  /** 播放选中的资源。 */
  play: [video: AvVideo]
  /** 切换选中资源的收藏状态。 */
  'toggle-favorite': [video: AvVideo]
}>()
</script>
