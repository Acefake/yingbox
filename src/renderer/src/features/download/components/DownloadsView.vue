<template>
  <section class="av-section">
    <PageHeader
      title="下载"
      as="h2"
      description="按番号从多个站点查找并下载到下载目录"
    >
      <template #actions>
        <form class="av-dl-form" @submit.prevent="submit">
          <UiInput
            v-model="code"
            aria-label="番号"
            placeholder="输入番号，如 ABP-001"
            :disabled="!downloads.available"
          />
          <UiButton
            type="submit"
            icon="download"
            label="加入队列"
            :disabled="!downloads.available || !code.trim()"
          />
        </form>
      </template>
    </PageHeader>
    <p v-if="notice" class="av-dl-notice" role="status">{{ notice }}</p>

    <StatusState
      v-if="!downloads.available"
      icon="download"
      title="下载不可用"
    />
    <StatusState
      v-else-if="!rows.length"
      icon="download"
      title="下载队列为空"
      hint="输入番号后回车即可开始下载"
    />
    <UiVirtualGrid
      v-else
      tag="ul"
      class="av-dl-list"
      :items="rows"
      :item-key="task => task.id"
    >
      <template #default="{ item: task }">
        <li class="av-dl-row">
          <div class="av-dl-text">
            <p class="av-dl-title">{{ task.id }}</p>
            <p class="av-dl-meta">{{ describe(task) }}</p>
            <div
              v-if="task.status === 'active' && task.progress"
              class="av-dl-progress"
              :class="{ 'is-indeterminate': percent(task) === undefined }"
              role="progressbar"
              :aria-valuenow="percent(task)"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                :style="
                  percent(task) === undefined
                    ? undefined
                    : { transform: `scaleX(${percent(task)! / 100})` }
                "
              />
            </div>
            <!-- 占位：所有行等高（虚拟列表按统一行距排） -->
            <div
              v-else
              class="av-dl-progress is-placeholder"
              aria-hidden="true"
            />
          </div>
          <UiIconButton
            v-if="task.status === 'failed'"
            icon="refresh"
            label="重试"
            @click="downloads.retry(task.id)"
          />
          <UiIconButton
            icon="trash"
            :label="task.status === 'active' ? '取消下载' : '移除'"
            danger
            @click="downloads.remove(task.id)"
          />
        </li>
      </template>
    </UiVirtualGrid>
  </section>
</template>

<script setup lang="ts">
/**
 * AV 下载视图：输入番号加入队列，列出进行中 / 等待 / 失败 / 已完成的任务。
 * 数据来自引擎 download 域（useDownloads），本组件只渲染与转发操作。
 */
import { computed, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiVirtualGrid from '@/components/ui/UiVirtualGrid.vue'
import { ADD_REASON, useDownloads } from '../api/download'
import type { DownloadTask } from '../../../../../shared/contract/download'
import StatusState from '@/components/StatusState.vue'

const downloads = useDownloads()
const code = ref('')
const notice = ref('')

/** 进行中 → 等待 → 失败 → 已完成 */
const rows = computed<DownloadTask[]>(() => {
  const s = downloads.snapshot.value
  return [
    ...(s.active ? [s.active] : []),
    ...s.queued,
    ...s.failed,
    ...s.completed,
  ]
})

/** 百分比；总量未知（直链没有 Content-Length）时为 undefined。 */
const percent = (task: DownloadTask): number | undefined =>
  task.progress?.total
    ? Math.round((task.progress.done / task.progress.total) * 100)
    : undefined

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const describe = (task: DownloadTask): string => {
  switch (task.status) {
    case 'active':
      if (!task.progress) return '正在查找视频源…'
      return percent(task) === undefined
        ? `下载中 · ${mb(task.progress.bytes)}`
        : `下载中 ${percent(task)}% · ${mb(task.progress.bytes)}`
    case 'queued':
      return '等待中'
    case 'failed':
      return `失败：${task.error ?? '未知错误'}`
    case 'done':
      return `已完成${task.site ? ` · ${task.site}` : ''} · ${task.file ?? ''}`
  }
}

const submit = async (): Promise<void> => {
  const value = code.value.trim()
  if (!value) return
  const result = await downloads.add(value)
  notice.value = result.added
    ? `已加入队列：${value.toUpperCase()}`
    : ADD_REASON[result.reason]
  if (result.added) code.value = ''
}
</script>

<style scoped>
.av-dl-form {
  display: flex;
  gap: var(--space-2);
}
.av-dl-notice {
  margin: 0 0 var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.av-dl-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.av-dl-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg);
  transition: var(--transition-fast);
}
.av-dl-row:hover {
  background: var(--bg-glass-hover);
}
.av-dl-text {
  min-width: 0;
  flex: 1;
}
.av-dl-title {
  margin: 0;
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
}
.av-dl-meta {
  overflow: hidden;
  margin: var(--space-1) 0 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.av-dl-progress {
  overflow: hidden;
  height: 3px;
  margin-top: var(--space-2);
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
}
.av-dl-progress.is-placeholder {
  visibility: hidden;
}
.av-dl-progress > div {
  height: 100%;
  background: var(--accent);
  transform-origin: left;
  transition: transform var(--duration-normal) var(--ease-out);
}
/* 总量未知：一小段来回滑动 */
.av-dl-progress.is-indeterminate > div {
  width: 30%;
  animation: av-dl-indeterminate var(--duration-pulse) var(--ease-out) infinite;
}
@keyframes av-dl-indeterminate {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(340%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .av-dl-progress.is-indeterminate > div {
    width: 100%;
    animation: none;
    opacity: 0.4;
  }
}
</style>
