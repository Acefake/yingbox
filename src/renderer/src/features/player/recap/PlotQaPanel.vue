<template>
  <aside
    class="plot-qa"
    :class="{ 'is-compact': compact }"
    aria-label="问剧情"
    @pointerdown.stop
  >
    <DialogTitlebar title="问剧情" icon="sparkle" @close="state.close" />
    <p class="plot-qa-scope">只根据当前进度之前的剧情回答，不剧透</p>
    <div ref="listEl" class="plot-qa-list">
      <p v-if="!state.messages.value.length" class="plot-qa-empty">
        比如：戴眼镜的那个人是谁？他为什么缺钱？
      </p>
      <div
        v-for="item in state.messages.value"
        :key="item.id"
        class="plot-qa-msg"
        :class="[`is-${item.role}`, { 'is-error': item.error }]"
      >
        <span
          v-if="item.role === 'user' && item.seconds !== undefined"
          class="plot-qa-time"
        >
          {{ formatClock(item.seconds) }}
        </span>
        <UiLoadingDots v-if="item.role === 'assistant' && !item.text" />
        <p v-else class="plot-qa-text">{{ item.text }}</p>
      </div>
    </div>
    <div class="plot-qa-input">
      <UiInput
        ref="inputRef"
        v-model="input"
        v-enter="submit"
        class="plot-qa-field"
        size="sm"
        placeholder="问点什么…"
        aria-label="问剧情"
        :disabled="!state.supported()"
      />
      <UiButton
        v-if="state.busy.value"
        size="sm"
        icon="stop"
        label="停止"
        @click="state.stop"
      />
      <UiButton
        v-else
        size="sm"
        variant="primary"
        icon="send"
        label="发送"
        :disabled="!state.input.value.trim()"
        @click="submit"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
/**
 * 播放器右侧的「问剧情」面板：消息列表 + 输入框，回答流式出现。
 * 状态与请求在 usePlotQa，这里只负责展示、打开时聚焦输入框、Esc 关闭和自动滚到底。
 * 尺寸按播放区容器（cqw / cqh）算；缩在小窗里（compact）铺满小窗、去掉说明行。
 */
import { nextTick, onMounted, ref, watch } from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { vEnter } from '@/directives/enter'

import { formatClock } from '../../../../../shared/recap/prompts'
import type { PlotQaState } from './use-plot-qa'

const props = withDefaults(
  defineProps<{
    state: PlotQaState
    /** 缩在角落小窗里 */
    compact?: boolean
  }>(),
  { compact: false }
)

const listEl = ref<HTMLElement | null>(null)
const inputRef = ref<InstanceType<typeof UiInput> | null>(null)
/** 输入框内容（usePlotQa 的 ref，直接双向绑定） */
const input = props.state.input

useEscapeLayer(
  () => props.state.open.value,
  () => props.state.close()
)

// 从设置菜单 / 右键菜单打开后焦点还停在已隐藏的菜单上：直接放到输入框
onMounted(async () => {
  await nextTick()
  inputRef.value?.focus({ preventScroll: true })
})

const submit = (): void => {
  void props.state.ask()
}

// 新消息或流式增量：滚到底
watch(
  () => {
    const list = props.state.messages.value
    return `${list.length}:${list.at(-1)?.text.length ?? 0}`
  },
  async () => {
    await nextTick()
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  }
)
</script>

<style scoped>
.plot-qa {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  bottom: 56px; /* style-tokens: layout（避开底部控制栏） */
  width: min(340px, calc(100cqw - 2 * var(--space-3)));
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow-lg);
  color: var(--text-primary);
  overflow: hidden;
}

/* 小窗：Artplayer 控制栏已隐藏，面板铺满小窗，底部让出小窗自己的悬停控制条 */
.plot-qa.is-compact {
  inset: var(--space-1) var(--space-1) 44px; /* style-tokens: layout（避开小窗控制条） */
  width: auto;
  border-radius: var(--radius-md);
}

.plot-qa.is-compact .plot-qa-scope {
  display: none;
}

.plot-qa-scope {
  margin: 0 var(--space-3) var(--space-2);
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}

.plot-qa-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 var(--space-3) var(--space-2);
}

.plot-qa-empty {
  margin: var(--space-4) 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  text-align: center;
}

.plot-qa-msg {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-width: 88%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-fill-secondary);
}

.plot-qa-msg.is-user {
  align-self: flex-end;
  background: var(--bg-active);
}

.plot-qa-msg.is-assistant {
  align-self: flex-start;
}

.plot-qa-msg.is-error .plot-qa-text {
  color: var(--danger);
}

.plot-qa-time {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
}

.plot-qa-text {
  margin: 0;
  white-space: pre-wrap;
  font-size: var(--text-sm);
  line-height: 1.6;
}

.plot-qa-input {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3) var(--space-3);
  border-top: 1px solid var(--border-default);
}

.plot-qa-field {
  flex: 1;
}
</style>
