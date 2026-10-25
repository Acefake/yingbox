<template>
  <div class="assistant-result" :class="`is-${result.kind}`">
    <template v-if="result.kind === 'cards'">
      <ul class="assistant-cards" :class="{ 'is-busy': opening !== null }">
        <li
          v-for="(card, index) in result.cards"
          :key="card.id"
          class="assistant-card-in assistant-card"
          :class="{ 'is-busy': isMine(card.id) }"
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
            <UiLoadingDots v-if="isMine(card.id)" label="正在打开…" />
            <span v-else-if="card.meta" class="assistant-card-meta">
              {{ card.meta }}
            </span>
            <span
              v-if="card.specs?.length || whyOf(card)"
              class="assistant-card-specs"
            >
              <UiSpecBadge
                v-for="spec in card.specs"
                :key="spec.variant + spec.text"
                :variant="spec.variant"
                :text="spec.text"
              />
              <span v-if="whyOf(card)" class="assistant-card-why">
                {{ whyOf(card) }}
              </span>
            </span>
          </span>
          <span v-if="card.actions" class="assistant-card-buttons">
            <UiButton
              v-for="action in card.actions()"
              :key="action.label"
              size="sm"
              :variant="action.primary ? 'primary' : 'secondary'"
              :label="action.label"
              :aria-label="`${action.label}：${card.title}`"
              :aria-expanded="
                action.panel ? expanded?.cardId === card.id : undefined
              "
              @click="act(card, action)"
            />
          </span>
          <UiButton
            v-else
            class="assistant-card-play"
            :variant="card.progress === undefined ? 'primary' : 'secondary'"
            size="sm"
            icon="play"
            :label="card.progress === undefined ? '播放' : '继续'"
            :aria-label="`${card.playLabel}：${card.title}`"
            :aria-busy="isMine(card.id)"
            :aria-disabled="opening !== null"
            @click="play(card)"
          />
        </li>
      </ul>
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
 * 带按钮的行（库外的片子：说明处写「未入库」等状态）右侧换成一组按钮，按钮可执行一次性动作，
 * 或在列表下方展开一个面板（同一时间只展开一张卡的面板，再点收起；结果换了就收起）。
 * 开始播放后通知外层收起助手。打开播放器期间：被点的那行在说明处显示「正在打开…」并标 aria-busy，
 * 其余按钮标 aria-disabled（保持可聚焦，点击不重复打开），那几行变淡。「正在打开」在整个侧栏共享
 * （assistant-opening.ts）：对话流里其它轮次的结果同样变淡、点击被忽略，播放器不会被打开两次。
 */
import { type Component, shallowRef, watch } from 'vue'

import {
  UiButton,
  UiIcon,
  UiLoadingDots,
  UiSpecBadge,
  toast,
} from '@/components/ui'

import { useOpening } from './assistant-opening'
import type {
  AssistantCardAction,
  AssistantMediaCard,
  AssistantResult,
} from './skills/skill-types'

const props = defineProps<{ result: AssistantResult }>()
const emit = defineEmits<{ played: [] }>()

/** 正在打开播放器的卡片（整个侧栏共享，见 assistant-opening.ts） */
const { opening, owner, isMine } = useOpening()
/** 展开的面板 */
const expanded = shallowRef<{
  cardId: string
  panel: { component: Component; props: Record<string, unknown> }
} | null>(null)

// 换了一批结果：上一批卡片展开的面板随之收起，不残留到新结果下
watch(
  () => props.result,
  () => {
    expanded.value = null
  }
)

/** 说明处的一行：状态角标（随入库状态变化）或时长角标，再接推荐理由 */
function whyOf(card: AssistantMediaCard): string {
  return [card.tag?.() ?? card.badge, card.reason].filter(Boolean).join(' · ')
}

async function play(card: AssistantMediaCard): Promise<void> {
  if (opening.value) return
  opening.value = { owner, cardId: card.id }
  try {
    if (await card.play()) emit('played')
    else toast.warning('没有找到能播放的文件')
  } catch {
    toast.error('无法打开播放器')
  } finally {
    opening.value = null
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
