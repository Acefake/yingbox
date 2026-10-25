<template>
  <div class="assistant-result" :class="`is-${result.kind}`">
    <ul
      v-if="result.kind === 'cards'"
      class="assistant-cards"
      :class="{ 'is-busy': playing !== null }"
    >
      <li
        v-for="(card, index) in result.cards"
        :key="card.id"
        class="assistant-card-in assistant-card"
        :class="{ 'is-busy': playing === card.id }"
        :style="{ '--i': index, '--progress': card.progress ?? 0 }"
      >
        <span class="assistant-card-cover" aria-hidden="true">
          <img v-if="card.image" :src="card.image" alt="" loading="lazy" />
          <span v-if="card.progress !== undefined" class="assistant-progress">
            <i class="assistant-progress-fill" />
          </span>
        </span>
        <span class="assistant-card-body">
          <span class="assistant-card-title">{{ card.title }}</span>
          <UiLoadingDots v-if="playing === card.id" label="正在打开…" />
          <span v-else-if="card.meta" class="assistant-card-meta">
            {{ card.meta }}
          </span>
          <span
            v-if="card.specs?.length || card.badge || card.reason"
            class="assistant-card-specs"
          >
            <UiSpecBadge
              v-for="spec in card.specs"
              :key="spec.variant + spec.text"
              :variant="spec.variant"
              :text="spec.text"
            />
            <span v-if="card.badge || card.reason" class="assistant-card-why">
              {{ [card.badge, card.reason].filter(Boolean).join(' · ') }}
            </span>
          </span>
        </span>
        <UiButton
          class="assistant-card-play"
          :variant="card.progress === undefined ? 'primary' : 'secondary'"
          size="sm"
          icon="play"
          :label="card.progress === undefined ? '播放' : '继续'"
          :aria-label="`${card.playLabel}：${card.title}`"
          :aria-busy="playing === card.id"
          :aria-disabled="playing !== null"
          @click="play(card)"
        />
      </li>
    </ul>

    <p
      v-else
      class="assistant-card-in assistant-done"
      :class="{ 'is-failed': !result.ok }"
    >
      <span class="assistant-done-icon"
        ><UiIcon :name="result.icon" size="sm"
      /></span>
      <span>{{ result.text }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * 助手面板里的结果（弹簧滑入，逐行错开）：
 * - 影片列表：小海报（有进度时底部一条进度条）、片名、一行说明、规格标签（UiSpecBadge）与角标 / 推荐理由，
 *   右侧「播放」（白底）或「继续」（有进度时，灰底）按钮；
 * - 一次性动作的回执：圆形图标 + 一句话。
 * 开始播放后通知外层收起助手。打开播放器期间：被点的那行在说明处显示「正在打开…」并标 aria-busy，
 * 其余按钮标 aria-disabled（保持可聚焦，点击不重复打开），那几行变淡。
 */
import { ref } from 'vue'

import {
  UiButton,
  UiIcon,
  UiLoadingDots,
  UiSpecBadge,
  toast,
} from '@/components/ui'

import type { AssistantMediaCard, AssistantResult } from './skills/skill-types'

defineProps<{ result: AssistantResult }>()
const emit = defineEmits<{ played: [] }>()

/** 正在打开播放器的卡片 */
const playing = ref<string | null>(null)

async function play(card: AssistantMediaCard): Promise<void> {
  if (playing.value) return
  playing.value = card.id
  try {
    if (await card.play()) emit('played')
    else toast.warning('没有找到能播放的文件')
  } catch {
    toast.error('无法打开播放器')
  } finally {
    playing.value = null
  }
}
</script>
