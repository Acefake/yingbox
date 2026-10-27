<template>
  <section class="offline-tasks" aria-label="离线任务">
    <StatusState
      v-if="list && !list.loggedIn"
      icon="lock"
      title="先登录 115"
      hint="离线下载用你的 115 账号，在设置 · 网盘里扫码登录后就能把磁力加进云下载。"
    >
      <UiButton size="sm" label="去登录" @click="openNetdiskSettings" />
    </StatusState>
    <template v-else>
      <div class="offline-tasks-bar">
        <p class="offline-tasks-note" role="status">
          {{ note }}
        </p>
        <UiIconButton
          icon="refresh"
          label="刷新"
          :loading="loading"
          @click="refresh"
        />
      </div>
      <StatusState
        v-if="error && !list"
        tone="danger"
        title="读取离线任务失败"
        :hint="error"
      />
      <StatusState
        v-else-if="list && !list.tasks.length"
        icon="cloud"
        title="还没有离线任务"
        hint="在磁力结果上点「115 离线下载」，下载完成后会自动通知片库入库。"
      />
      <ul v-else-if="list" class="offline-tasks-list">
        <li
          v-for="task in list.tasks"
          :key="task.hash"
          class="offline-task"
          :class="`is-${task.status}`"
        >
          <div class="offline-task-head">
            <p class="offline-task-name" :title="task.name">{{ task.name }}</p>
            <span class="offline-task-status">{{
              offlineStatusLabel(task)
            }}</span>
          </div>
          <div
            v-if="task.status !== 'failed'"
            class="offline-task-track"
            role="progressbar"
            :aria-label="`${task.name} 进度`"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="Math.floor(task.percent)"
          >
            <div
              class="offline-task-bar"
              :style="{ transform: `scaleX(${task.percent / 100})` }"
            />
          </div>
          <p class="offline-task-meta">
            <span v-for="part in offlineMeta(task)" :key="part">{{
              part
            }}</span>
            <span v-if="task.error" class="offline-task-error">{{
              task.error
            }}</span>
          </p>
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
/**
 * 网盘页「离线任务」：经影盒添加的 115 云下载任务，进度条、状态（等待 / 下载中 / 已完成 · 是否已入库 / 失败）、
 * 失败原因、保存到的文件夹。未登录 115 时引导去设置扫码。数据与刷新在 useOfflineTasks。
 */
import { computed, onMounted } from 'vue'

import StatusState from '@/components/StatusState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'

import { offlineDownloads, openNetdiskSettings } from '../api'
import { useOfflineTasks } from '../composables/use-offline'
import { offlineMeta, offlineStatusLabel } from '../utils/netdisk-rules'

const { list, loading, error, refresh, start } = useOfflineTasks({
  api: offlineDownloads,
})
onMounted(start)

const note = computed(() => {
  if (!list.value) return loading.value ? '正在读取…' : ''
  const where = list.value.folder ? `「${list.value.folder}」` : '根目录'
  const parts = [
    `新任务默认存到 115 的${where}（电影默认目录，结果上方的胶囊可另选）`,
  ]
  if (list.value.error) parts.push(`同步失败：${list.value.error}`)
  return parts.join('；')
})
</script>

<style scoped>
.offline-tasks {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.offline-tasks-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.offline-tasks-note {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.offline-tasks-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.offline-task {
  display: flex;
  flex-direction: column;
  gap: var(--space-2_5);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-xl);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
}
.offline-task-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-4);
  min-width: 0;
}
.offline-task-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.offline-task-status {
  flex: none;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.offline-task.is-done .offline-task-status {
  color: var(--success);
}
.offline-task.is-failed .offline-task-status,
.offline-task-error {
  color: var(--danger);
}
.offline-task-track {
  overflow: hidden;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--bg-fill-tertiary);
}
.offline-task-bar {
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transform-origin: left center;
  transition: transform var(--duration-normal) var(--ease-out);
}
.offline-task.is-done .offline-task-bar {
  background: var(--success);
}
.offline-task-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3_5);
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
</style>
