<template>
  <div class="lib-actors custom-scrollbar">
    <div class="lib-actors-bar">
      <UiInput
        v-model="search"
        class="lib-actors-search"
        variant="filled"
        size="sm"
        icon="search"
        clearable
        placeholder="搜索演员或别名"
        aria-label="搜索演员"
      />
      <UiSelect
        v-model="sort"
        class="lib-actors-select"
        size="sm"
        aria-label="演员排序"
        :options="sortOptions"
      />
      <span v-if="loaded" class="lib-actors-count">
        {{ total.toLocaleString('zh-CN') }} 位
      </span>
      <UiIconButton
        icon="refresh"
        size="sm"
        label="重新获取全部演员资料"
        :loading="refreshing"
        @click="refreshAll"
      />
    </div>

    <UiVirtualGrid
      v-if="actors.length"
      :items="actors"
      class="lib-actors-grid"
      :item-key="actor => actor.id"
    >
      <template #default="{ item: actor }">
        <UiPressable class="lib-actor-card" @click="emit('open', actor.id)">
          <span class="lib-actor-photo">
            <img
              v-if="actor.photo"
              :src="photoOf(actor.photo)"
              alt=""
              loading="lazy"
              decoding="async"
              draggable="false"
              referrerpolicy="no-referrer"
            />
            <span v-else>{{ initialOf(actor.name) }}</span>
          </span>
          <strong class="lib-actor-name">{{ actor.name }}</strong>
          <small class="lib-actor-works">{{ actor.workCount }} 部作品</small>
        </UiPressable>
      </template>
    </UiVirtualGrid>
    <LibraryEmpty
      v-else-if="loaded"
      inline
      :title="search ? `没有找到“${search}”` : '还没有演员'"
      :text="
        error ||
        (search
          ? undefined
          : '番号文件夹里的影片识别完成后，演员会出现在这里。')
      "
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 番号库的演员列表：圆形头像 + 名字 + 作品数，虚拟网格只渲染视口附近的卡片；
 * 搜索名字 / 别名、按作品数 / 名字 / 最近入库排序，点开演员详情。
 * 「重新获取全部」排一个低优先级的后台任务（忽略缓存）。
 */
import { toast } from '@/components/ui'
import { ref } from 'vue'

import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'

import { errorText, libraryBridge } from '../api/bridge'
import { itemImage } from '../api/images'
import LibraryEmpty from '../page/LibraryEmpty.vue'
import { ACTOR_SORT_OPTIONS, initialOf } from './actor-rules'
import { useActorList } from './use-actor-list'

const emit = defineEmits<{ open: [actorId: number] }>()

const { actors, total, loaded, error, search, sort } = useActorList()
const sortOptions = ACTOR_SORT_OPTIONS.map(o => ({ ...o }))
const refreshing = ref(false)

const photoOf = (photo: string): string | undefined =>
  itemImage(photo, 300) ?? undefined

async function refreshAll(): Promise<void> {
  const bridge = libraryBridge()
  if (!bridge) return
  refreshing.value = true
  try {
    await bridge.actors.refresh()
    toast.info('已在后台重新获取演员资料')
  } catch (e) {
    toast.error(errorText(e))
  } finally {
    refreshing.value = false
  }
}
</script>

<style scoped>
.lib-actors {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.lib-actors-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--content-padding-x) var(--space-5);
}
.lib-actors-search {
  flex: 0 0 240px;
}
.lib-actors-select {
  flex: 0 0 auto;
  width: auto;
}
.lib-actors-count {
  flex: 1 1 auto;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.lib-actors-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: var(--space-7) var(--space-5);
  margin: 0 var(--content-padding-x) var(--space-10);
}
.lib-actor-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  text-align: center;
  cursor: pointer;
}
.lib-actor-photo {
  display: grid;
  width: 100%;
  max-width: 128px;
  aspect-ratio: 1;
  margin-bottom: var(--space-3);
  overflow: hidden;
  place-items: center;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
  color: var(--text-tertiary);
  font-size: var(--text-2xl);
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-normal) var(--ease-out);
}
.lib-actor-card:hover .lib-actor-photo {
  transform: scale(1.03);
}
.lib-actor-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 20%;
}
.lib-actor-name {
  max-width: 100%;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-actor-works {
  margin-top: var(--space-0_5);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
</style>
