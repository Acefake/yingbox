<template>
  <Teleport to="body">
    <Transition name="sqp-fade">
      <div v-if="visible" class="sqp-overlay" @click="emit('close')" />
    </Transition>

    <Transition name="sqp-slide">
      <aside
        v-if="visible"
        class="sqp-panel"
        role="dialog"
        aria-label="后台任务"
        :style="{
          '--sqp-left': `${anchorPos.left}px`,
          '--sqp-anchor-bottom': `${anchorPos.bottom}px`,
        }"
        @click.stop
      >
        <DialogTitlebar title="后台任务" icon="list" @close="emit('close')" />

        <!-- 去码 / 边跑边看：主进程里的后台任务，这里只读展示并可停止 -->
        <div v-if="hasRuntime" class="sqp-runtime-body">
          <div
            v-if="restoreRunning"
            class="sqp-row sqp-job is-processing"
            role="status"
            aria-live="polite"
          >
            <div class="sqp-status" aria-hidden="true">
              <span class="sqp-spin" />
            </div>
            <div class="sqp-info">
              <div class="sqp-name" :title="restoreName">
                去码中 · {{ restoreName }}
              </div>
              <div class="sqp-job-detail">
                <span class="sqp-job-track" aria-hidden="true">
                  <span
                    class="sqp-job-fill"
                    :style="{ width: `${restorePercent}%` }"
                  />
                </span>
                <span class="sqp-job-value">{{ restorePercentText }}</span>
              </div>
            </div>
            <div class="sqp-actions">
              <UiIconButton
                icon="close"
                size="sm"
                label="取消去码"
                @click="cancelRestore"
              />
            </div>
          </div>

          <div
            v-if="hasLive"
            class="sqp-row sqp-job"
            role="status"
            aria-live="polite"
          >
            <div class="sqp-status" aria-hidden="true">
              <span class="sqp-dot is-live" />
            </div>
            <div class="sqp-info">
              <div class="sqp-name" :title="liveName">
                边跑边看 · {{ liveName }}
              </div>
              <div class="sqp-meta" :class="{ 'is-error': liveFailed }">
                {{ liveSummary }}
              </div>
            </div>
            <div class="sqp-actions">
              <UiIconButton
                v-if="liveFailed"
                icon="close"
                size="sm"
                label="关闭"
                @click="dismissLive"
              />
              <UiIconButton
                v-else
                icon="stop"
                size="sm"
                label="停止边跑边看"
                @click="stopLive"
              />
            </div>
          </div>
        </div>
        <div v-else class="sqp-empty">
          <p>暂无后台任务</p>
          <span>去码、边跑边看开始后会显示在这里</span>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 后台任务浮层：从侧栏「后台任务」按钮上方弹出，展示去码 / 边跑边看。
 * 任务状态在主进程里，这里只读展示，提供取消 / 停止 / 关闭。
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { useLadaTasks } from '@/features/lada'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()
/** 面板从侧栏底部「后台任务」按钮上方弹出，打开时按按钮的实时位置锚定 */
const anchorPos = ref({ left: 12, bottom: 96 })

function anchorPanel(): void {
  // 窄屏走整幅底部样式，不做小结锚定
  if (window.matchMedia('(max-width: 768px)').matches) return
  const rect = document
    .querySelector('[data-queue-anchor]')
    ?.getBoundingClientRect()
  if (!rect || !rect.height) return
  anchorPos.value = {
    left: Math.max(12, Math.round(rect.left) - 6),
    bottom: Math.max(16, Math.round(window.innerHeight - rect.top) + 8),
  }
}

watch(
  () => props.visible,
  visible => {
    if (visible) nextTick(anchorPanel)
  }
)

const {
  restoreRunning,
  restoreName,
  restorePercent,
  restorePercentText,
  hasLive,
  liveName,
  liveFailed,
  liveSummary,
  hasRuntime,
  cancelRestore,
  stopLive,
  dismissLive,
} = useLadaTasks()

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.sqp-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  background: var(--overlay-scrim-soft);
  backdrop-filter: blur(4px);
}

.sqp-panel {
  position: fixed;
  z-index: calc(var(--z-sheet) + 1);
  display: flex;
  flex-direction: column;
  /* 锚定值走变量，窄屏的媒体查询才会真正接管定位 */
  left: var(--sqp-left, var(--space-3));
  bottom: var(
    --sqp-anchor-bottom,
    96px
  ); /* style-tokens: layout（由 JS 锚定的回退值） */
  width: min(380px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - var(--sqp-anchor-bottom, 96px) - 16px));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.sqp-runtime-body {
  display: flex;
  flex-direction: column;
}

.sqp-job-detail {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.sqp-job-track {
  flex: 1 1 auto;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
  overflow: hidden;
}

.sqp-job-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width var(--duration-normal) var(--ease-out);
}

.sqp-job-value {
  flex: 0 1 auto;
  min-width: 0;
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sqp-dot.is-live {
  border-color: var(--accent);
  animation: sqp-live-pulse var(--duration-pulse) ease-out infinite;
}

@keyframes sqp-live-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 35%, transparent);
  }
  50% {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sqp-dot.is-live {
    animation: none;
  }
}

.sqp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-9) var(--space-5);
  color: var(--text-tertiary);
  text-align: center;
}

.sqp-empty p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.sqp-empty span {
  font-size: var(--text-xs);
}

.sqp-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--separator);
  transition: background var(--duration-fast) var(--ease-out);
}

.sqp-row:last-child {
  border-bottom: 0;
}

.sqp-row.is-processing {
  background: var(--bg-active-soft);
}

.sqp-status {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
}

.sqp-spin {
  width: 13px;
  height: 13px;
  border-radius: var(--radius-full);
  border: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-top-color: var(--accent);
  animation: sqp-spin var(--duration-spin) linear infinite;
}

@keyframes sqp-spin {
  to {
    transform: rotate(360deg);
  }
}

.sqp-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--radius-full);
  border: 1.5px solid var(--text-quaternary, var(--text-tertiary));
}

.sqp-info {
  flex: 1;
  min-width: 0;
}

.sqp-name {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sqp-meta {
  margin-top: var(--space-0_5);
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sqp-meta.is-error {
  color: var(--danger);
}

.sqp-actions {
  display: flex;
  gap: var(--space-0_5);
  flex-shrink: 0;
}

.sqp-fade-enter-active,
.sqp-fade-leave-active {
  transition: opacity var(--duration-fast) ease;
}

.sqp-fade-enter-from,
.sqp-fade-leave-to {
  opacity: 0;
}

.sqp-slide-enter-active {
  transition:
    opacity var(--duration-fast) ease,
    transform var(--duration-fast) var(--ease-out);
}

.sqp-slide-leave-active {
  transition:
    opacity var(--duration-fast) ease,
    transform var(--duration-fast) ease;
}

.sqp-slide-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.sqp-slide-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.99);
}

@media (max-width: 768px) {
  .sqp-panel {
    bottom: 0;
    left: 0;
    width: 100%;
    max-height: min(70vh, 520px);
    border-radius: var(--radius-lg, var(--radius-xl))
      var(--radius-lg, var(--radius-xl)) 0 0;
  }
}
</style>
