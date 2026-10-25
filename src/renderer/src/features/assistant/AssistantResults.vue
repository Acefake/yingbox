<template>
  <div class="assistant-result" :class="`is-${result.kind}`">
    <div
      v-if="result.kind === 'cards'"
      class="assistant-cards"
      :class="{ 'is-busy': playing !== null }"
    >
      <UiPressable
        v-for="(card, index) in result.cards"
        :key="card.id"
        class="assistant-card-in assistant-card"
        :class="{ 'is-busy': playing === card.id }"
        :style="{ '--i': index, '--progress': card.progress ?? 0 }"
        :title="card.reason || undefined"
        :aria-busy="playing === card.id"
        :aria-disabled="playing !== null"
        @click="play(card)"
      >
        <span class="assistant-card-cover">
          <img v-if="card.image" :src="card.image" alt="" loading="lazy" />
          <span v-if="card.badge" class="assistant-card-badge">
            {{ card.badge }}
          </span>
        </span>
        <span class="assistant-card-body">
          <span class="assistant-card-title">{{ card.title }}</span>
          <UiLoadingDots v-if="playing === card.id" label="正在打开…" />
          <span v-else-if="card.meta" class="assistant-card-meta">
            {{ card.meta }}
          </span>
          <span class="assistant-card-action">{{ card.playLabel }}</span>
        </span>
        <span
          v-if="card.progress !== undefined"
          class="assistant-progress"
          aria-hidden="true"
        >
          <i class="assistant-progress-fill" />
        </span>
      </UiPressable>
    </div>

    <p
      v-else
      class="assistant-card-in assistant-done"
      :class="{ 'is-failed': !result.ok }"
    >
      <UiIcon :name="result.icon" size="sm" />
      <span>{{ result.text }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * 助手面板里的结果（弹簧滑入，逐张错开）：封面卡片（角标写时长或看到多少，下面一行类型 · 评分 · 规格，
 * 有进度时底部一条进度条，整张可点开播），以及一次性动作的回执。开始播放后通知外层收起助手。
 * 打开播放器期间：被点的卡片在说明行显示「正在打开…」并标 aria-busy，其余卡片变淡并标 aria-disabled
 * （保持可聚焦，点击不重复打开）。
 */
import { ref } from 'vue'

import { UiIcon, UiLoadingDots, UiPressable, toast } from '@/components/ui'

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
