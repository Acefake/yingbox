<template>
  <Teleport to="body">
    <Transition name="lib-hover">
      <div
        v-if="item"
        :key="item.id"
        class="lib-hover-card"
        :style="{ left: `${position.left}px`, top: `${position.top}px` }"
        role="tooltip"
        @pointerenter="emit('enter')"
        @pointerleave="emit('leave')"
      >
        <UiPressable
          block
          class="lib-hover-hero"
          :label="`查看 ${item.title} 详情`"
          @click="emit('open', item.id)"
        >
          <img v-if="hero" :src="hero" alt="" decoding="async" />
          <span v-else class="lib-hover-hero-fallback">{{ item.title }}</span>
        </UiPressable>
        <div class="lib-hover-body">
          <strong class="lib-hover-title">{{ item.title }}</strong>
          <p v-if="facts?.meta.length" class="lib-hover-meta">
            <span v-for="part in facts.meta" :key="part">{{ part }}</span>
          </p>
          <div class="lib-hover-actions">
            <UiButton
              variant="primary"
              size="sm"
              icon="play"
              label="播放"
              :disabled="!playRequest"
              @click="playNow"
            />
            <UiButton
              size="sm"
              icon="info"
              label="详情"
              @click="emit('open', item.id)"
            />
            <UiButton
              size="sm"
              icon="sparkle"
              label="重新识别"
              @click="emit('identify', item.id)"
            />
          </div>
          <template v-if="facts">
            <dl v-if="facts.rows.length" class="lib-hover-facts">
              <div
                v-for="row in facts.rows"
                :key="row.label"
                class="lib-hover-fact"
                :class="{ 'is-wrap': row.wrap }"
              >
                <dt>{{ row.label }}</dt>
                <dd>{{ row.value }}</dd>
              </div>
            </dl>
            <p v-else-if="facts.overview" class="lib-hover-overview">
              {{ facts.overview }}
            </p>
          </template>
          <UiSkeleton v-else class="lib-hover-skeleton" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 海报悬停详情卡：横版封面、片名、日期 / 时长 / 评分、
 * 播放 / 详情 / 重新识别，制作商、系列、导演、演员、标签。显隐与定位在 use-hover-card.ts，
 * 信息与位置规则在 hover-card-rules.ts。详情还没取到时先显示骨架。
 */
import { toast } from '@/components/ui'
import { computed } from 'vue'

import type {
  LibraryItemNode,
  LibraryItemSummary,
} from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'

import { itemImage } from '../api/images'
import { play, primaryPlayRequest } from '../detail/playback'
import { hoverFactsOf } from './hover-card-rules'

const props = defineProps<{
  item: LibraryItemSummary | null
  node: LibraryItemNode | null
  position: { left: number; top: number }
}>()

const emit = defineEmits<{
  enter: []
  leave: []
  open: [itemId: number]
  identify: [itemId: number]
  played: []
}>()

const hero = computed(() =>
  props.item ? itemImage(props.item.backdrop ?? props.item.poster, 780) : null
)
const facts = computed(() => (props.node ? hoverFactsOf(props.node) : null))
const playRequest = computed(() =>
  props.node ? primaryPlayRequest(props.node) : null
)

async function playNow(): Promise<void> {
  const request = playRequest.value
  if (!request) return
  emit('played')
  const ok = await play(
    request,
    itemImage(props.item?.poster ?? null, 780) ?? undefined
  )
  if (!ok) toast.warning('当前环境无法播放本地文件')
}
</script>

<style scoped src="./hover-card.css"></style>
