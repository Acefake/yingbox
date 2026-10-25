<template>
  <div class="assistant-result" :class="`is-${result.kind}`">
    <template v-if="result.kind === 'cards'">
      <div class="assistant-cards" :class="{ 'is-busy': playing !== null }">
        <template v-for="(card, index) in result.cards" :key="card.id">
          <div
            v-if="card.actions"
            class="assistant-card-in assistant-card is-static"
            :style="{ '--i': index }"
            :title="card.reason || undefined"
          >
            <span class="assistant-card-cover">
              <img v-if="card.image" :src="card.image" alt="" loading="lazy" />
              <span v-if="card.tag" class="assistant-card-badge">
                {{ card.tag() }}
              </span>
            </span>
            <span class="assistant-card-body">
              <span class="assistant-card-title">{{ card.title }}</span>
              <span v-if="card.meta" class="assistant-card-meta">
                {{ card.meta }}
              </span>
              <span class="assistant-card-buttons">
                <UiButton
                  v-for="action in card.actions()"
                  :key="action.label"
                  size="sm"
                  :variant="action.primary ? 'primary' : 'secondary'"
                  :label="action.label"
                  :aria-expanded="
                    action.panel ? expanded?.cardId === card.id : undefined
                  "
                  @click="act(card, action)"
                />
              </span>
            </span>
          </div>
          <UiPressable
            v-else
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
        </template>
      </div>
      <div v-if="expanded" class="assistant-card-in assistant-panel-slot">
        <component
          :is="expanded.panel.component"
          :key="expanded.cardId"
          v-bind="expanded.panel.props"
          @played="emit('played')"
        />
      </div>
    </template>

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
 * 带按钮的卡片（库外的片子：角标写「未入库」等状态）整张不可点，按钮可执行一次性动作，
 * 或在卡片列表下方展开一个面板（同一时间只展开一张卡的面板，再点收起）。
 */
import { type Component, ref, shallowRef } from 'vue'

import {
  UiButton,
  UiIcon,
  UiLoadingDots,
  UiPressable,
  toast,
} from '@/components/ui'

import type {
  AssistantCardAction,
  AssistantMediaCard,
  AssistantResult,
} from './skills/skill-types'

defineProps<{ result: AssistantResult }>()
const emit = defineEmits<{ played: [] }>()

/** 正在打开播放器的卡片 */
const playing = ref<string | null>(null)
/** 展开的面板 */
const expanded = shallowRef<{
  cardId: string
  panel: { component: Component; props: Record<string, unknown> }
} | null>(null)

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

async function act(
  card: AssistantMediaCard,
  action: AssistantCardAction
): Promise<void> {
  if (action.panel) {
    expanded.value =
      expanded.value?.cardId === card.id
        ? null
        : { cardId: card.id, panel: action.panel }
    return
  }
  try {
    if (await action.run?.()) emit('played')
  } catch {
    toast.error('操作失败')
  }
}
</script>
