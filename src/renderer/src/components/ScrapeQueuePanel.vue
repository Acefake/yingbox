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
        aria-label="刮削队列"
        :style="{
          '--sqp-left': `${anchorPos.left}px`,
          '--sqp-anchor-bottom': `${anchorPos.bottom}px`,
        }"
        @click.stop
      >
        <DialogTitlebar title="刮削队列" icon="list" @close="emit('close')" />

        <!-- 去码 / 边跑边看：都是后台任务，收起时只留一行摘要 -->
        <section v-if="hasRuntime" class="sqp-runtime">
          <div class="sqp-runtime-head" @click="toggleRuntime">
            <span
              v-if="restoreRunning"
              class="sqp-spin sqp-runtime-spin"
              aria-hidden="true"
            />
            <UiIcon v-else name="sparkle" size="sm" />
            <span class="sqp-runtime-label">后台任务</span>
            <span class="sqp-runtime-summary" :title="runtimeSummary">{{
              runtimeSummary
            }}</span>
            <UiIconButton
              size="sm"
              :icon="runtimeOpen ? 'chevronUp' : 'chevronDown'"
              :label="runtimeOpen ? '收起后台任务' : '展开后台任务'"
              :aria-expanded="runtimeOpen"
              aria-controls="sqp-runtime-body"
              @click.stop="toggleRuntime"
            />
          </div>

          <div
            v-if="!runtimeOpen && restoreRunning"
            class="sqp-runtime-track"
            aria-hidden="true"
          >
            <div
              class="sqp-runtime-fill"
              :style="{ width: `${restorePercent}%` }"
            />
          </div>

          <div
            v-else-if="runtimeOpen"
            id="sqp-runtime-body"
            class="sqp-runtime-body"
          >
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
        </section>

        <p class="sqp-subtitle">
          <template v-if="activeCount > 0">
            {{ activeCount }} 进行中 · {{ doneCount }}/{{ totalCount }}
          </template>
          <template v-else-if="totalCount > 0">
            全部结束 · {{ doneCount }}/{{ totalCount }}
          </template>
          <template v-else>暂无任务</template>
        </p>

        <div v-if="totalCount === 0" class="sqp-empty">
          <p>还没有刮削任务</p>
          <span>从电影列表右键「刮削」即可加入队列</span>
        </div>

        <div v-else class="sqp-list custom-scrollbar">
          <div
            v-for="item in items"
            :key="item.id"
            class="sqp-row"
            :class="`is-${item.status}`"
          >
            <div class="sqp-status" aria-hidden="true">
              <span v-if="item.status === 'processing'" class="sqp-spin" />
              <span v-else-if="item.status === 'pending'" class="sqp-dot" />
              <UiIcon
                v-else-if="item.status === 'done'"
                class="sqp-mark ok"
                name="check"
                size="sm"
              />
              <UiIcon
                v-else-if="item.status === 'error'"
                class="sqp-mark err"
                name="warning"
                size="sm"
              />
              <UiIcon v-else class="sqp-mark mute" name="minus" size="sm" />
            </div>

            <div class="sqp-info">
              <div class="sqp-name" :title="item.name">{{ item.name }}</div>
              <div
                v-if="item.steps?.length && item.status === 'processing'"
                class="sqp-steps"
              >
                <span
                  v-for="(step, idx) in item.steps"
                  :key="idx"
                  class="sqp-step"
                  :class="{ done: step.done }"
                  :title="step.name"
                />
              </div>
              <div v-else class="sqp-meta" :class="metaClass(item)">
                {{ metaText(item) }}
              </div>
            </div>

            <span class="yb-chip sqp-type">{{
              item.type === 'tv' ? '剧集' : '电影'
            }}</span>

            <div class="sqp-actions">
              <UiIconButton
                v-if="item.status === 'pending' || item.status === 'processing'"
                icon="close"
                size="sm"
                label="取消"
                @click="cancelItem(item.id)"
              />
              <UiIconButton
                v-if="canRetry(item.id)"
                icon="refresh"
                size="sm"
                label="重试"
                @click="retryFailed(item.id)"
              />
              <UiIconButton
                v-if="
                  item.status === 'done' ||
                  item.status === 'error' ||
                  item.status === 'cancelled'
                "
                icon="trash"
                size="sm"
                label="移除"
                @click="removeQueueItem(item.id)"
              />
            </div>
          </div>
        </div>

        <footer v-if="totalCount > 0" class="sqp-footer">
          <div class="sqp-progress-track" aria-hidden="true">
            <div
              class="sqp-progress-fill"
              :style="{ width: `${Math.round(progress * 100)}%` }"
            />
          </div>
          <div class="sqp-footer-actions">
            <UiButton
              size="sm"
              label="清除已完成"
              :disabled="doneCount === 0"
              @click="clearCompleted"
            />
            <UiButton
              size="sm"
              :label="`重试失败（${failedCount}）`"
              :disabled="failedCount === 0"
              @click="retryAllFailed"
            />
            <UiButton
              class="sqp-clear-all"
              size="sm"
              label="全部清除"
              @click="clearAll"
            />
          </div>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 全局刮削队列浮层：从侧栏「刮削队列」按钮上方弹出。
 * 上半部分是去码 / 边跑边看等后台任务（可折叠），下面是刮削任务列表和批量操作。
 */
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import type { GlobalQueueItem } from '@/composables/use-global-queue'
import { useGlobalQueue } from '@/composables/use-global-queue'
import { useLadaTasks } from '@/composables/use-lada-tasks'
import { useScrapingTask } from '@/views/Movie/composables/use-scraping-task'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()
/** 面板从侧栏底部「刮削队列」按钮上方弹出，打开时按按钮的实时位置锚定 */
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
  items,
  totalCount,
  doneCount,
  failedCount,
  activeCount,
  progress,
  cancelItem,
  canRetry,
} = useGlobalQueue()

const {
  retryFailed,
  retryAllFailed,
  removeQueueItem,
  clearCompleted,
  clearAll,
} = useScrapingTask()

// 去码 / 边跑边看的状态在主进程里，这里只读展示
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
  runtimeSummary,
  cancelRestore,
  stopLive,
  dismissLive,
} = useLadaTasks()

/** 收起状态跟着用户走，别每次打开都重新展开 */
const runtimeOpen = ref(localStorage.getItem('queueRuntimeOpen') === '1')

function toggleRuntime(): void {
  runtimeOpen.value = !runtimeOpen.value
  localStorage.setItem('queueRuntimeOpen', runtimeOpen.value ? '1' : '0')
}

const metaText = (item: GlobalQueueItem): string => {
  if (item.status === 'processing') return item.currentStep || '处理中…'
  if (item.status === 'pending') return '等待中'
  if (item.status === 'done') return '完成'
  if (item.status === 'cancelled') return '已取消'
  if (item.status === 'error')
    return item.errorMessage || item.currentStep || '失败'
  return ''
}

const metaClass = (item: GlobalQueueItem): string => {
  if (item.status === 'error') return 'is-error'
  if (item.status === 'done') return 'is-done'
  if (item.status === 'cancelled') return 'is-muted'
  if (item.status === 'pending') return 'is-muted'
  return ''
}

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
  z-index: 2050;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(4px);
}

.sqp-panel {
  position: fixed;
  z-index: 2051;
  display: flex;
  flex-direction: column;
  /* 锚定值走变量，窄屏的媒体查询才会真正接管定位 */
  left: var(--sqp-left, 12px);
  bottom: var(--sqp-anchor-bottom, 96px);
  width: min(380px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - var(--sqp-anchor-bottom, 96px) - 16px));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.sqp-runtime {
  border-bottom: 1px solid var(--separator);
}

.sqp-runtime-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 40px;
  padding: 0 var(--space-2) 0 var(--space-4);
  color: var(--text-primary);
  font-size: var(--text-xs);
  cursor: pointer;
}
.sqp-runtime-head:hover {
  background: var(--bg-glass-hover);
}
.sqp-runtime-head > .app-icon {
  flex: 0 0 auto;
  color: var(--text-secondary);
}
.sqp-runtime-spin {
  flex: 0 0 auto;
}
.sqp-runtime-label {
  flex: 0 0 auto;
  font-weight: var(--font-weight-medium);
}
.sqp-runtime-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
}

/* 收起时只留一条线，进度仍然看得见 */
.sqp-runtime-track {
  height: 2px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
}
.sqp-runtime-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s var(--ease-out);
}

.sqp-runtime-body {
  display: flex;
  flex-direction: column;
}
.sqp-runtime-body .sqp-row:last-child {
  border-bottom: 0;
}

.sqp-job-detail {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
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
  transition: width 0.2s var(--ease-out);
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
  animation: sqp-live-pulse 1.4s ease-out infinite;
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

.sqp-subtitle {
  margin: 10px 16px;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.sqp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 48px 20px;
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

.sqp-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.sqp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--separator);
  transition: background 0.15s var(--ease-out);
}
.sqp-row:last-child {
  border-bottom: 0;
}
.sqp-row.is-processing {
  background: var(--bg-active-soft);
}
.sqp-row.is-error {
  background: color-mix(in srgb, var(--danger) 7%, transparent);
}
.sqp-row.is-done,
.sqp-row.is-cancelled {
  opacity: 0.72;
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
  animation: sqp-spin 0.75s linear infinite;
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

.sqp-mark {
  stroke-width: 2.25;
}
.sqp-mark.ok {
  color: var(--success);
}
.sqp-mark.err {
  color: var(--danger);
}
.sqp-mark.mute {
  color: var(--text-tertiary);
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
  margin-top: 2px;
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sqp-meta.is-error {
  color: var(--danger);
}
.sqp-meta.is-done {
  color: var(--success);
}
.sqp-meta.is-muted {
  color: var(--text-tertiary);
}

.sqp-steps {
  display: flex;
  gap: 3px;
  margin-top: 5px;
}
.sqp-step {
  width: 16px;
  height: 3px;
  border-radius: var(--radius-xs);
  background: var(--bg-fill-tertiary, var(--bg-fill-secondary));
}
.sqp-step.done {
  background: var(--accent);
}

.sqp-type {
  flex-shrink: 0;
  font-size: var(--text-2xs);
  padding: 1px 8px;
}

.sqp-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.sqp-footer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 14px;
  border-top: 1px solid var(--separator);
}
.sqp-progress-track {
  height: 3px;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
  overflow: hidden;
}
.sqp-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transition: width 0.4s var(--ease-out);
}
.sqp-footer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sqp-clear-all:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.sqp-fade-enter-active,
.sqp-fade-leave-active {
  transition: opacity 0.18s ease;
}
.sqp-fade-enter-from,
.sqp-fade-leave-to {
  opacity: 0;
}

.sqp-slide-enter-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s var(--ease-out);
}
.sqp-slide-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.12s ease;
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
