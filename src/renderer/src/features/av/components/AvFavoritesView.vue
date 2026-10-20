<template>
  <section class="av-section">
    <PageHeader
      title="收藏"
      as="h2"
      :description="
        favorites.length ? `共 ${favorites.length} 个收藏` : 'AV 资源收藏'
      "
    >
      <template v-if="favorites.length" #actions>
        <UiIconButton
          icon="trash"
          label="清空收藏"
          danger
          @click="emit('clear')"
        />
      </template>
    </PageHeader>

    <UiVirtualGrid
      v-if="favorites.length"
      :items="favorites"
      class="ui-poster-grid is-landscape"
      :item-key="fav => fav._uid"
    >
      <template #default="{ item: fav }">
        <UiPosterCard
          shape="landscape"
          :title="fav.vod_name"
          :cover="coverSrc(fav)"
          :subtitle="fav._source"
          :favorite="true"
          @open="emit('play', fav)"
          @toggle-favorite="emit('toggle-favorite', fav)"
        />
      </template>
    </UiVirtualGrid>
    <StatusState
      v-else
      icon="heart"
      title="还没有收藏"
      hint="悬停海报，点右上角的收藏按钮"
    />
  </section>
</template>

<script setup lang="ts">
/**
 * AV 收藏视图：横版海报网格 + 清空。收藏数据由父组件持有，这里只展示和转发事件。
 */
import PageHeader from '@/components/PageHeader.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPosterCard from '@/components/ui/UiPosterCard.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'

import { coverSrc } from '../utils/av-media'
import StatusState from '@/components/StatusState.vue'

defineProps<{ favorites: any[] }>()

const emit = defineEmits<{
  play: [video: any]
  'toggle-favorite': [video: any]
  clear: []
}>()
</script>
