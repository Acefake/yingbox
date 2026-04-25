<template>
  <!-- 顶部栏队列按钮，始终显示 -->
  <div class="queue-trigger" ref="triggerRef" @click="togglePanel">
    <!-- 进度环 -->
    <div class="ring-wrap">
      <svg class="ring-svg" viewBox="0 0 28 28">
        <circle cx="14" cy="14" r="11" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2" />
        <circle
          cx="14" cy="14" r="11"
          fill="none"
          :stroke="activeCount > 0 ? '#60a5fa' : (totalCount > 0 ? '#34d399' : 'rgba(255,255,255,0.2)')"
          stroke-width="2"
          stroke-linecap="round"
          :stroke-dasharray="ringCircumference"
          :stroke-dashoffset="ringCircumference * (1 - progress)"
          class="ring-arc"
        />
      </svg>
      <!-- 活跃脉冲点 -->
      <span v-if="activeCount > 0" class="pulse-dot">
        <span class="pulse-ping"></span>
        <span class="pulse-core"></span>
      </span>
    </div>
    <!-- 文字 -->
    <span class="queue-label">
      <span v-if="activeCount > 0" class="label-active">{{ activeCount }} 进行中</span>
      <span v-else-if="totalCount > 0" class="label-done">全部完成</span>
      <span v-else class="label-empty">任务队列</span>
    </span>
    <!-- 展开箭头 -->
    <svg class="chevron" :class="{ open: panelVisible }" viewBox="0 0 10 6" fill="currentColor">
      <path d="M0 0l5 6 5-6z" />
    </svg>
  </div>

  <!-- 下拉面板 -->
  <Teleport to="body">
    <Transition name="panel-drop">
      <div v-if="panelVisible" class="queue-panel" :style="panelStyle" ref="panelRef">
        <!-- 面板头 -->
        <div class="panel-header">
          <span class="panel-title">任务队列</span>
          <div class="panel-header-actions">
            <span class="panel-count">{{ doneCount }}/{{ totalCount }}</span>
            <button v-if="doneCount > 0" class="action-btn" @click.stop="clearCompleted">清除完成</button>
            <button v-if="totalCount > 0" class="action-btn danger" @click.stop="clearAll">全部清除</button>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="totalCount === 0" class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-icon">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p>暂无任务</p>
        </div>

        <!-- 任务列表 -->
        <div v-else class="task-list">
          <TransitionGroup name="task-item">
            <div
              v-for="item in items"
              :key="item.id"
              class="task-row"
              :class="[`status-${item.status}`]"
            >
              <!-- 状态图标 -->
              <div class="task-status-icon">
                <span v-if="item.status === 'processing'" class="spin-ring"></span>
                <svg v-else-if="item.status === 'done'" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2.5" class="icon-sm">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <svg v-else-if="item.status === 'error'" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.5" class="icon-sm">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <svg v-else-if="item.status === 'cancelled'" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" class="icon-sm">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
                <span v-else class="pending-dot"></span>
              </div>

              <!-- 信息 -->
              <div class="task-info">
                <div class="task-name">{{ item.name }}</div>
                <div v-if="item.status === 'processing' && item.currentStep" class="task-step">{{ item.currentStep }}</div>
                <div v-else-if="item.status === 'cancelled'" class="task-step cancelled">已取消</div>
                <div v-else-if="item.status === 'error'" class="task-step error">失败</div>
              </div>

              <!-- 类型徽章 -->
              <span class="type-badge" :class="`type-${item.type}`">
                {{ item.type === 'movie' ? '电影' : item.type === 'tv' ? '剧集' : '下载' }}
              </span>

              <!-- 操作按钮 -->
              <div class="task-actions">
                <!-- 取消（进行中/等待中且可取消） -->
                <button
                  v-if="(item.status === 'processing' || item.status === 'pending') && item.cancellable"
                  class="icon-action cancel"
                  title="取消"
                  @click.stop="cancelItem(item.id)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-xs">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <!-- 移除（已完成/错误/取消） -->
                <button
                  v-if="item.status === 'done' || item.status === 'error' || item.status === 'cancelled'"
                  class="icon-action remove"
                  title="移除"
                  @click.stop="removeItem(item.id)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon-xs">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </TransitionGroup>
        </div>

        <!-- 底部进度条 -->
        <div v-if="totalCount > 0" class="panel-footer">
          <div class="progress-bar-track">
            <div class="progress-bar-fill" :style="{ width: `${progress * 100}%` }"></div>
          </div>
          <span class="progress-text">{{ Math.round(progress * 100) }}%</span>
        </div>
      </div>
    </Transition>

    <!-- 点击外部关闭 -->
    <div v-if="panelVisible" class="panel-overlay" @click="panelVisible = false"></div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useGlobalQueue } from '@/composables/use-global-queue'

const { items, activeCount, totalCount, doneCount, progress, clearCompleted, clearAll, cancelItem, removeItem } = useGlobalQueue()

const panelVisible = ref(false)
const triggerRef = ref<HTMLElement | null>(null)

const panelStyle = ref({ top: '0px', right: '0px' })

const ringCircumference = computed(() => 2 * Math.PI * 11)

const togglePanel = () => {
  panelVisible.value = !panelVisible.value
  if (panelVisible.value) updatePanelPos()
}

const updatePanelPos = () => {
  if (!triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  panelStyle.value = {
    top: `${rect.bottom + 8}px`,
    right: `${window.innerWidth - rect.right}px`,
  }
}

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') panelVisible.value = false
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
/* ── Trigger button ── */
.queue-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px 5px 7px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.04);
  transition: background 0.15s, border-color 0.15s;
  -webkit-app-region: no-drag;
  user-select: none;
}
.queue-trigger:hover {
  background: rgba(255,255,255,0.09);
  border-color: rgba(255,255,255,0.14);
}

.ring-wrap {
  position: relative;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
.ring-svg {
  width: 22px;
  height: 22px;
  transform: rotate(-90deg);
}
.ring-arc {
  transition: stroke-dashoffset 0.6s ease, stroke 0.3s;
}

.pulse-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
}
.pulse-ping {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: #60a5fa;
  opacity: 0.6;
  animation: ping 1.2s cubic-bezier(0,0,0.2,1) infinite;
}
.pulse-core {
  position: absolute;
  inset: 1px;
  border-radius: 50%;
  background: #3b82f6;
}
@keyframes ping {
  75%, 100% { transform: scale(2); opacity: 0; }
}

.queue-label {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.label-active { color: #93c5fd; }
.label-done   { color: #6ee7b7; }
.label-empty  { color: rgba(255,255,255,0.4); }

.chevron {
  width: 8px;
  height: 5px;
  color: rgba(255,255,255,0.3);
  transition: transform 0.2s;
  flex-shrink: 0;
}
.chevron.open { transform: rotate(180deg); }

/* ── Panel ── */
.queue-panel {
  position: fixed;
  width: 320px;
  border-radius: 14px;
  border: 1px solid rgba(255,255,255,0.09);
  background: rgba(12,16,28,0.97);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04);
  z-index: 99999;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-overlay {
  position: fixed;
  inset: 0;
  z-index: 99998;
}

.panel-header {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  gap: 8px;
}
.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.85);
  flex: 1;
}
.panel-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.panel-count {
  font-size: 11px;
  color: rgba(255,255,255,0.3);
}
.action-btn {
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.5);
  cursor: pointer;
  transition: all 0.15s;
}
.action-btn:hover {
  background: rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.8);
}
.action-btn.danger:hover {
  background: rgba(239,68,68,0.15);
  border-color: rgba(239,68,68,0.3);
  color: #fca5a5;
}

/* Empty */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
  gap: 8px;
  color: rgba(255,255,255,0.2);
}
.empty-icon { width: 32px; height: 32px; }
.empty-state p { font-size: 12px; margin: 0; }

/* Task list */
.task-list {
  max-height: 320px;
  overflow-y: auto;
  overflow-x: hidden;
}
.task-list::-webkit-scrollbar { width: 3px; }
.task-list::-webkit-scrollbar-track { background: transparent; }
.task-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

.task-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  transition: background 0.15s;
}
.task-row:last-child { border-bottom: none; }
.task-row.status-processing { background: rgba(59,130,246,0.07); }
.task-row.status-done       { opacity: 0.7; }
.task-row.status-cancelled  { opacity: 0.45; }
.task-row.status-error      { background: rgba(239,68,68,0.05); }

.task-status-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.spin-ring {
  width: 13px;
  height: 13px;
  border: 2px solid rgba(96,165,250,0.25);
  border-top-color: #60a5fa;
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
  display: block;
}
@keyframes spin { to { transform: rotate(360deg); } }

.icon-sm { width: 13px; height: 13px; }
.pending-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,0.25);
  display: block;
}

.task-info {
  flex: 1;
  min-width: 0;
}
.task-name {
  font-size: 12px;
  color: rgba(255,255,255,0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.task-step {
  font-size: 10px;
  color: #93c5fd;
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.task-step.cancelled { color: rgba(255,255,255,0.25); }
.task-step.error     { color: #f87171; }

.type-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
  letter-spacing: 0.02em;
}
.type-movie    { background: rgba(139,92,246,0.25); color: #c4b5fd; }
.type-tv       { background: rgba(59,130,246,0.25); color: #93c5fd; }
.type-download { background: rgba(16,185,129,0.25); color: #6ee7b7; }

.task-actions {
  flex-shrink: 0;
  display: flex;
  gap: 2px;
}
.icon-action {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
  background: transparent;
  color: rgba(255,255,255,0.3);
}
.icon-action:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
.icon-action.cancel:hover { background: rgba(239,68,68,0.15); color: #f87171; }
.icon-xs { width: 11px; height: 11px; }

/* Footer progress */
.panel-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid rgba(255,255,255,0.06);
}
.progress-bar-track {
  flex: 1;
  height: 3px;
  background: rgba(255,255,255,0.07);
  border-radius: 2px;
  overflow: hidden;
}
.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6);
  border-radius: 2px;
  transition: width 0.5s ease;
}
.progress-text {
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  min-width: 28px;
  text-align: right;
}

/* Transitions */
.panel-drop-enter-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.panel-drop-leave-active { transition: opacity 0.14s ease, transform 0.12s ease; }
.panel-drop-enter-from  { opacity: 0; transform: translateY(-6px) scale(0.97); }
.panel-drop-leave-to    { opacity: 0; transform: translateY(-4px) scale(0.98); }

.task-item-enter-active { transition: all 0.2s ease; }
.task-item-leave-active { transition: all 0.15s ease; }
.task-item-enter-from   { opacity: 0; transform: translateX(-8px); }
.task-item-leave-to     { opacity: 0; transform: translateX(8px); max-height: 0; }
</style>
