<template>
  <Teleport to="body">
    <Transition name="sqp-fade">
      <div
        v-if="visible"
        class="sqp-overlay"
        @click="emit('close')"
      />
    </Transition>

    <Transition name="sqp-slide">
      <aside
        v-if="visible"
        class="sqp-panel"
        role="dialog"
        aria-label="刮削队列"
        @click.stop
      >
        <header class="sqp-header">
          <div>
            <h2 class="sqp-title">刮削队列</h2>
            <p class="sqp-subtitle">
              <template v-if="activeCount > 0">{{ activeCount }} 进行中 · {{ doneCount }}/{{ totalCount }}</template>
              <template v-else-if="totalCount > 0">全部结束 · {{ doneCount }}/{{ totalCount }}</template>
              <template v-else>暂无任务</template>
            </p>
          </div>
          <button class="sqp-close" type="button" aria-label="关闭刮削队列" @click="emit('close')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
              <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" />
            </svg>
          </button>
        </header>

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
              <span v-else-if="item.status === 'done'" class="sqp-mark ok">✓</span>
              <span v-else-if="item.status === 'error'" class="sqp-mark err">!</span>
              <span v-else class="sqp-mark mute">–</span>
            </div>

            <div class="sqp-info">
              <div class="sqp-name" :title="item.name">{{ item.name }}</div>
              <div v-if="item.steps?.length && item.status === 'processing'" class="sqp-steps">
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

            <span class="yb-chip sqp-type">{{ item.type === 'tv' ? '剧集' : '电影' }}</span>

            <div class="sqp-actions">
              <button
                v-if="item.status === 'pending' || item.status === 'processing'"
                type="button"
                class="sqp-action"
                title="取消"
                @click="cancelItem(item.id)"
              >
                取消
              </button>
              <button
                v-if="canRetry(item.id)"
                type="button"
                class="sqp-action accent"
                title="重试"
                @click="retryFailed(item.id)"
              >
                重试
              </button>
              <button
                v-if="item.status === 'done' || item.status === 'error' || item.status === 'cancelled'"
                type="button"
                class="sqp-action"
                title="移除"
                @click="removeQueueItem(item.id)"
              >
                移除
              </button>
            </div>
          </div>
        </div>

        <footer v-if="totalCount > 0" class="sqp-footer">
          <div class="sqp-progress-track" aria-hidden="true">
            <div class="sqp-progress-fill" :style="{ width: `${Math.round(progress * 100)}%` }" />
          </div>
          <div class="sqp-footer-actions">
            <button
              type="button"
              class="yb-btn-soft sqp-footer-btn"
              :disabled="doneCount === 0"
              @click="clearCompleted"
            >
              清除已完成
            </button>
            <button
              type="button"
              class="yb-btn-soft sqp-footer-btn"
              :disabled="failedCount === 0"
              @click="retryAllFailed"
            >
              重试失败（{{ failedCount }}）
            </button>
            <button
              type="button"
              class="yb-btn-soft sqp-footer-btn danger"
              @click="clearAll"
            >
              全部清除
            </button>
          </div>
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import type { GlobalQueueItem } from '@/composables/use-global-queue'
import { useGlobalQueue } from '@/composables/use-global-queue'
import { useScrapingTask } from '@/views/Movie/composables/use-scraping-task'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()

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

const metaText = (item: GlobalQueueItem): string => {
  if (item.status === 'processing') return item.currentStep || '处理中…'
  if (item.status === 'pending') return '等待中'
  if (item.status === 'done') return '完成'
  if (item.status === 'cancelled') return '已取消'
  if (item.status === 'error') return item.errorMessage || item.currentStep || '失败'
  return ''
}

const metaClass = (item: GlobalQueueItem): string => {
  if (item.status === 'error') return 'is-error'
  if (item.status === 'done') return 'is-done'
  if (item.status === 'cancelled') return 'is-muted'
  if (item.status === 'pending') return 'is-muted'
  return ''
}

const onKeydown = (e: KeyboardEvent) => {
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
  top: calc(var(--titlebar-height) + 10px);
  right: 16px;
  z-index: 2051;
  display: flex;
  flex-direction: column;
  width: min(420px, calc(100vw - 24px));
  max-height: min(560px, calc(100vh - var(--titlebar-height) - 28px));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg, 14px);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.sqp-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--separator);
}

.sqp-title {
  margin: 0;
  font-size: var(--text-lg, 16px);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.sqp-subtitle {
  margin: 4px 0 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.sqp-close {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  background: transparent;
  cursor: pointer;
  transition: var(--transition-fast);
}
.sqp-close:hover {
  color: var(--text-primary);
  background: var(--bg-glass-hover);
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
.sqp-row:last-child { border-bottom: 0; }
.sqp-row.is-processing {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
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
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-top-color: var(--accent);
  animation: sqp-spin 0.75s linear infinite;
}
@keyframes sqp-spin { to { transform: rotate(360deg); } }

.sqp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--text-quaternary, var(--text-tertiary));
}

.sqp-mark {
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}
.sqp-mark.ok { color: var(--success); }
.sqp-mark.err { color: var(--danger); }
.sqp-mark.mute { color: var(--text-tertiary); }

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
  font-size: 11px;
  color: var(--accent-text, var(--accent));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sqp-meta.is-error { color: var(--danger); }
.sqp-meta.is-done { color: var(--success); }
.sqp-meta.is-muted { color: var(--text-tertiary); }

.sqp-steps {
  display: flex;
  gap: 3px;
  margin-top: 5px;
}
.sqp-step {
  width: 16px;
  height: 3px;
  border-radius: 2px;
  background: var(--bg-fill-tertiary, var(--bg-fill-secondary));
}
.sqp-step.done {
  background: var(--accent);
}

.sqp-type {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 8px;
}

.sqp-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.sqp-action {
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-tertiary);
  font-size: 11px;
  cursor: pointer;
  transition: var(--transition-fast);
}
.sqp-action:hover {
  background: var(--bg-glass-hover);
  color: var(--text-primary);
}
.sqp-action.accent:hover {
  background: var(--accent-soft);
  color: var(--accent-text);
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
  border-radius: 99px;
  background: var(--bg-fill-secondary);
  overflow: hidden;
}
.sqp-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 55%, #5ac8fa));
  transition: width 0.4s var(--ease-out);
}
.sqp-footer-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sqp-footer-btn {
  min-height: 28px;
  padding: 0 10px;
  font-size: 11px;
}
.sqp-footer-btn.danger:hover {
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.sqp-fade-enter-active,
.sqp-fade-leave-active { transition: opacity 0.18s ease; }
.sqp-fade-enter-from,
.sqp-fade-leave-to { opacity: 0; }

.sqp-slide-enter-active { transition: opacity 0.18s ease, transform 0.18s var(--ease-out); }
.sqp-slide-leave-active { transition: opacity 0.14s ease, transform 0.12s ease; }
.sqp-slide-enter-from { opacity: 0; transform: translateY(-8px) scale(0.98); }
.sqp-slide-leave-to { opacity: 0; transform: translateY(-4px) scale(0.99); }

@media (max-width: 768px) {
  .sqp-panel {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: 100%;
    max-height: min(70vh, 520px);
    border-radius: var(--radius-lg, 14px) var(--radius-lg, 14px) 0 0;
  }
}
</style>