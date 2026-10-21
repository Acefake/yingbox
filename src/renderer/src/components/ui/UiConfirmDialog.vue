<template>
  <dialog
    ref="dialogEl"
    class="ui-confirm"
    :class="{ 'is-closing': flow.state.settled }"
    :style="{ width: `${options.width ?? 360}px` }"
    :aria-labelledby="titleId"
    @cancel.prevent="flow.cancel()"
  >
    <h2 :id="titleId" class="ui-confirm__title">{{ options.title }}</h2>
    <p v-if="typeof options.content === 'string'" class="ui-confirm__content">
      {{ options.content }}
    </p>
    <div v-else-if="options.content" class="ui-confirm__content is-custom">
      <ContentRender />
    </div>
    <p v-if="flow.state.error" class="ui-confirm__error" role="alert">
      {{ flow.state.error }}
    </p>
    <div class="ui-confirm__actions">
      <UiButton
        :label="options.cancelText ?? '取消'"
        :disabled="flow.state.busy"
        :autofocus="options.danger || undefined"
        @click="flow.cancel()"
      />
      <UiButton
        :label="options.okText ?? '好'"
        :variant="options.danger ? 'danger' : 'primary'"
        :loading="flow.state.busy"
        :autofocus="!options.danger || undefined"
        @click="flow.ok()"
      />
    </div>
  </dialog>
</template>

<script setup lang="ts">
/**
 * confirmDialog 的界面：由 confirm.ts 渲染到 body，页面里不要直接使用。
 * 状态和流程全在 ConfirmFlow 里，这里只负责打开原生 <dialog>、把按钮接到流程上。
 */
import {
  type FunctionalComponent,
  type VNode,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
} from 'vue'

import type { ConfirmFlow, ConfirmOptions } from './confirm'
import UiButton from './UiButton.vue'

const props = defineProps<{ options: ConfirmOptions; flow: ConfirmFlow }>()

const dialogEl = ref<HTMLDialogElement | null>(null)
const titleId = useId()

/** 渲染函数形式的 content：在本组件里调用，里面的 ref 绑定到这里 */
const ContentRender: FunctionalComponent = () => {
  const content = props.options.content
  return typeof content === 'function' ? (content() as VNode) : null
}

onMounted(() => dialogEl.value?.showModal())
onBeforeUnmount(() => dialogEl.value?.close())
</script>

<style>
.ui-confirm {
  box-sizing: border-box;
  max-width: calc(100vw - var(--space-8));
  margin: auto;
  padding: var(--space-6) var(--space-5) var(--space-5);
  border: 1px solid var(--border-glass);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-family: var(--font-sans);
  text-align: center;
  box-shadow: var(--shadow-lg);
  animation: ui-confirm-in var(--duration-normal) var(--ease-out);
}
.ui-confirm::backdrop {
  background: var(--overlay-scrim-soft);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: ui-confirm-fade var(--duration-normal) ease;
}
.ui-confirm.is-closing,
.ui-confirm.is-closing::backdrop {
  opacity: 0;
  transition: opacity var(--duration-fast) ease;
}
.ui-confirm__title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  line-height: var(--leading-tight);
}
.ui-confirm__content {
  margin: var(--space-2) 0 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
/* 放表单的内容左对齐 */
.ui-confirm__content.is-custom {
  text-align: left;
}
.ui-confirm__error {
  margin: var(--space-3) 0 0;
  color: var(--danger);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
.ui-confirm__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
.ui-confirm__actions > .ui-button {
  flex: 1 1 0;
  min-width: 0;
}
@keyframes ui-confirm-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}
@keyframes ui-confirm-fade {
  from {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ui-confirm {
    animation: ui-confirm-fade var(--duration-fast) ease;
  }
}
</style>
