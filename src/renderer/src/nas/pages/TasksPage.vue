<template>
  <section class="nas-page">
    <PageHeader
      title="片库任务"
      description="扫描、识别和整理任务；115 离线下载进度在网盘页查看"
    />
    <StatusState v-if="error" title="读取任务失败" :hint="error" />
    <StatusState
      v-else-if="!jobs.length"
      icon="list"
      title="当前没有片库任务"
    />
    <ul v-else class="nas-page-body">
      <li v-for="job in jobs" :key="job.jobId" class="nas-task">
        <div>
          <p>{{ jobTitle(job.jobType) }}</p>
          <p class="nas-task-description">
            {{
              [
                libraries.find(library => library.id === job.libraryId)?.name,
                job.state === 'running' ? '运行中' : '排队中',
                progress[job.jobId],
              ]
                .filter(Boolean)
                .join(' · ')
            }}
          </p>
        </div>
        <UiIconButton
          icon="close"
          label="取消任务"
          :loading="cancelling.includes(job.jobId)"
          @click="cancel(job.jobId)"
        />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { onActivated, onDeactivated, ref } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import StatusState from '@/components/StatusState.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { useActiveJobs } from '@/features/library'

const active = ref(false)
const { jobs, libraries, error, progress, cancelling, cancel } =
  useActiveJobs(active)
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
})
const names: Record<string, string> = {
  scan: '扫描片库',
  parse: '解析媒体文件',
  fingerprint: '计算文件指纹',
  identify: '识别影片',
  'writer-write': '写出元数据',
  'writer-organize': '整理文件',
  'writer-undo': '撤销整理',
  'writer-auto-organize': '自动整理文件',
  probe: '检测视频信息',
  'visual-frames': '提取画面',
}

function jobTitle(type: string): string {
  return names[type] ?? '片库任务'
}
</script>
