<template>
  <div ref="root" class="lib-actor-detail" tabindex="-1">
    <div v-if="!actor" class="lib-actor-detail-status">
      <template v-if="loading">正在载入…</template>
      <template v-else>
        {{ error || '演员不存在或已被移除' }}
        <UiButton label="返回" variant="secondary" @click="emit('close')" />
      </template>
    </div>
    <PosterWall
      v-else
      :list="list"
      :version="version"
      :count="total"
      :selected="NO_SELECTION"
      :selection-version="0"
      :label="`${actor.name}的作品`"
      @visible="setVisible"
      @activate="(_index, item) => emit('open-item', item.id)"
    >
      <template #before>
        <ActorProfile
          :actor="actor"
          :refreshing="refreshing"
          @close="emit('close')"
          @edit="editing = true"
          @refresh="refresh"
        />
        <h2 class="lib-actor-works-title">
          作品<span v-if="ready">{{ total.toLocaleString('zh-CN') }}</span>
        </h2>
      </template>
      <template #after>
        <LibraryEmpty
          v-if="ready && total === 0"
          inline
          title="还没有关联的作品"
        />
      </template>
    </PosterWall>
    <ActorEditSheet
      :open="editing"
      :actor="actor"
      @close="editing = false"
      @saved="actor = $event"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 演员详情（覆盖在海报墙上，由路由 ?actor= 驱动）：资料头 + 作品墙。
 * 作品墙复用海报墙的虚拟网格与分页查询（query.actorId），资料头放在海报墙的 before 插槽里一起滚动。
 * 资料变化（后台查到 / 编辑）经 actors-changed 事件刷新；点作品打开条目详情。
 */
import { toast } from '@/components/ui'
import { nextTick, ref, shallowRef, watch } from 'vue'

import type { ActorDetail as Actor } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'

import { errorText, libraryBridge } from '../api/bridge'
import LibraryEmpty from '../page/LibraryEmpty.vue'
import { onLibraryEvent } from '../state/library-events'
import { usePagedQuery } from '../state/use-paged-query'
import PosterWall from '../wall/PosterWall.vue'
import ActorEditSheet from './ActorEditSheet.vue'
import ActorProfile from './ActorProfile.vue'
import { worksQuery } from './actor-rules'

const props = defineProps<{ actorId: number }>()
const emit = defineEmits<{ close: []; 'open-item': [itemId: number] }>()

const NO_SELECTION: ReadonlySet<number> = new Set()
const bridge = libraryBridge()
const root = ref<HTMLElement | null>(null)
const actor = shallowRef<Actor | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const editing = ref(false)
const refreshing = ref(false)

async function load(resetView: boolean): Promise<void> {
  if (!bridge) return
  const id = props.actorId
  loading.value = true
  try {
    const next = await bridge.actors.get(id)
    if (id !== props.actorId) return
    actor.value = next
    error.value = null
    if (resetView) {
      await nextTick()
      root.value?.focus({ preventScroll: true })
    }
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}

watch(
  () => props.actorId,
  () => void load(true),
  { immediate: true }
)

onLibraryEvent(event => {
  if (
    event.type === 'actors-changed' &&
    (event.reset || event.actorIds.includes(props.actorId))
  )
    void load(false)
})

// 作品墙：任何番号库条目的变化都可能影响作品（识别后关联变化），交给分页查询局部刷新
const { list, version, total, ready, setVisible } = usePagedQuery(
  () => worksQuery(props.actorId),
  () => true
)

async function refresh(): Promise<void> {
  if (!bridge) return
  refreshing.value = true
  try {
    await bridge.actors.refresh([props.actorId])
    toast.info('已在后台重新获取资料')
  } catch (e) {
    toast.error(errorText(e))
  } finally {
    refreshing.value = false
  }
}
</script>

<style scoped>
.lib-actor-detail {
  position: absolute;
  inset: 0;
  z-index: var(--z-float);
  background: var(--bg-content);
  outline: none;
}
.lib-actor-detail-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  height: 100%;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
.lib-actor-works-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0 var(--content-padding-x) var(--space-5);
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}
.lib-actor-works-title span {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-regular);
  font-variant-numeric: tabular-nums;
}
</style>
