<template>
  <div class="assistant-result" :class="`is-${result.kind}`">
    <div v-if="result.kind === 'picks'" class="assistant-picks">
      <div
        v-for="(card, index) in result.cards"
        :key="card.id"
        class="assistant-card-in assistant-pick"
        :style="{ '--i': index }"
      >
        <UiPosterCard
          :title="card.title"
          :cover="card.image ?? undefined"
          :subtitle="card.meta"
          thumb
          @open="play(card)"
        />
        <p v-if="card.reason" class="assistant-pick-reason">
          {{ card.reason }}
        </p>
      </div>
    </div>

    <div v-else-if="result.kind === 'continue'" class="assistant-continue">
      <article
        v-for="(card, index) in result.cards"
        :key="card.id"
        class="assistant-card-in assistant-continue-card"
        :style="{ '--i': index, '--progress': card.progress ?? 0 }"
      >
        <div class="assistant-continue-cover">
          <img v-if="card.image" :src="card.image" alt="" loading="lazy" />
        </div>
        <div class="assistant-continue-body">
          <h3 class="assistant-continue-title">{{ card.title }}</h3>
          <p v-if="card.meta" class="assistant-continue-meta">
            {{ card.meta }}
          </p>
          <div class="assistant-progress" aria-hidden="true">
            <i class="assistant-progress-fill" />
          </div>
        </div>
        <UiButton
          variant="primary"
          size="sm"
          icon="play"
          :label="card.playLabel"
          :loading="playing === card.id"
          @click="play(card)"
        />
      </article>
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
 * 助手面板里的结果卡片（弹簧滑入，逐张错开）：推荐的海报（点击播放）、继续播放（进度条 +「继续播放」）、
 * 播放器控制的回执。开始播放后通知外层收起助手。
 */
import { ref } from 'vue'

import { UiButton, UiIcon, UiPosterCard, toast } from '@/components/ui'

import type { AssistantMediaCard, AssistantResult } from './assistant-actions'

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
