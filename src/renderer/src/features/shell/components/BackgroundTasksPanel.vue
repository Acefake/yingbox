<template>
  <Teleport to="body">
    <Transition name="sqp-fade">
      <div v-if="visible" class="sqp-overlay" @click="emit('close')" />
    </Transition>

    <Transition name="sqp-slide">
      <aside
        v-if="visible"
        class="sqp-panel yb-glass"
        role="dialog"
        aria-label="后台任务"
        :style="{
          '--sqp-left': `${anchorPos.left}px`,
          '--sqp-anchor-bottom': `${anchorPos.bottom}px`,
        }"
        @click.stop
      >
        <header class="sqp-head">
          <h2 class="sqp-title">后台任务</h2>
          <span v-if="runningCount" class="sqp-count">
            {{ runningCount }} 项任务
          </span>
          <UiIconButton
            class="sqp-action sqp-close"
            icon="close"
            variant="secondary"
            size="sm"
            label="关闭"
            @click="emit('close')"
          />
        </header>

        <!-- 媒体库识别 / 刷新元数据（跨电影、剧集、番号分区）；去码 / 边跑边看：主进程里的后台任务，只读展示并可停止 -->
        <div v-if="hasRuntime || jobs.length || jobsError" class="sqp-body">
          <h3 v-if="runningCount" class="sqp-group">任务</h3>

          <p v-if="jobsError" class="sqp-meta">
            媒体库任务加载失败：{{ jobsError }}
          </p>
          <div
            v-for="job in shownJobs"
            :key="job.jobId"
            class="sqp-job"
            :class="{ 'is-running': job.state === 'running' }"
          >
            <span class="sqp-status" aria-hidden="true">
              <span v-if="job.state === 'running'" class="sqp-spin" />
              <UiIcon v-else name="clock" size="md" />
            </span>
            <div class="sqp-info">
              <div class="sqp-name">
                <UiIcon class="sqp-kind" name="database" size="sm" /><span
                  class="sqp-name-text"
                  >{{ jobName(job.jobType) }}</span
                >
              </div>
              <div class="sqp-meta">
                {{
                  cancelling.includes(job.jobId)
                    ? '正在取消'
                    : job.state === 'queued'
                      ? '排队中'
                      : '运行中（可能正在等待其他任务）'
                }}<template v-if="jobProgress[job.jobId]">
                  · {{ jobProgress[job.jobId] }}</template
                ><template v-if="job.libraryId">
                  · {{ libraryName(job.libraryId) }}</template
                ><template v-if="job.batchId">
                  · 批次 {{ job.batchId }}</template
                >
              </div>
            </div>
            <UiIconButton
              class="sqp-action"
              icon="close"
              variant="secondary"
              size="sm"
              :label="`取消${jobName(job.jobType)}`"
              :loading="cancelling.includes(job.jobId)"
              @click="cancelJob(job.jobId)"
            />
          </div>

          <div
            v-if="restoreRunning"
            class="sqp-job is-running"
            role="status"
            aria-live="polite"
          >
            <span class="sqp-status" aria-hidden="true">
              <span class="sqp-spin" />
            </span>
            <div class="sqp-info">
              <div class="sqp-name" :title="restoreName">
                <UiIcon class="sqp-kind" name="wand" size="sm" />
                <span class="sqp-name-text">去码 · {{ restoreName }}</span>
              </div>
              <div class="sqp-bar">
                <span class="sqp-track" aria-hidden="true">
                  <span
                    class="sqp-fill"
                    :style="{ width: `${restorePercent}%` }"
                  />
                </span>
                <span class="sqp-value">{{ restorePercentText }}</span>
              </div>
            </div>
            <UiIconButton
              class="sqp-action"
              icon="close"
              variant="secondary"
              size="sm"
              label="取消去码"
              @click="cancelRestore"
            />
          </div>

          <h3 v-if="liveFailed" class="sqp-group">需要处理</h3>
          <div
            v-if="hasLive"
            class="sqp-job"
            :class="{ 'is-running': !liveFailed }"
            role="status"
            aria-live="polite"
          >
            <span class="sqp-status" aria-hidden="true">
              <UiIcon
                v-if="liveFailed"
                class="sqp-warn"
                name="warning"
                size="md"
              />
              <span v-else class="sqp-dot" />
            </span>
            <div class="sqp-info">
              <div class="sqp-name" :title="liveName">
                <UiIcon class="sqp-kind" name="livePlay" size="sm" />
                <span class="sqp-name-text">边跑边看 · {{ liveName }}</span>
              </div>
              <div class="sqp-meta">{{ liveSummary }}</div>
            </div>
            <UiIconButton
              v-if="liveFailed"
              class="sqp-action"
              icon="close"
              variant="secondary"
              size="sm"
              label="关闭"
              @click="dismissLive"
            />
            <UiIconButton
              v-else
              class="sqp-action"
              icon="stop"
              variant="secondary"
              size="sm"
              label="停止边跑边看"
              @click="stopLive"
            />
          </div>
        </div>
        <div v-else class="sqp-empty">
          <p>暂无后台任务</p>
          <span>媒体库任务、去码、边跑边看开始后会显示在这里</span>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 后台任务浮层（玻璃 .yb-glass）：从侧栏「后台任务」按钮旁弹出，按「进行中 / 需要处理」分组，
 * 展示媒体库识别进度、去码 / 边跑边看。任务状态在主进程 / 媒体库引擎里，这里只读展示，
 * 提供取消 / 停止 / 关闭；样式在 background-tasks-panel.css。
 */
import { computed, nextTick, ref, toRef, watch } from 'vue'

import UiIcon from '@/components/ui/UiIcon.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useLadaTasks } from '@/features/lada'
import { useActiveJobs } from '@/features/library'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ close: [] }>()
/** 面板贴在侧栏右侧、与侧栏底边对齐（侧栏收起成图标栏时同样贴边），打开时按侧栏的实时位置锚定 */
const anchorPos = ref({ left: 12, bottom: 12 })

function anchorPanel(): void {
  // 窄屏走整幅底部样式，不做锚定
  if (window.matchMedia('(max-width: 768px)').matches) return
  const anchor = document.querySelector('[data-queue-anchor]')
  const rect = (anchor?.closest('aside') ?? anchor)?.getBoundingClientRect()
  if (!rect || !rect.height) return
  anchorPos.value = {
    left: Math.round(rect.right) + 12,
    bottom: Math.max(12, Math.round(window.innerHeight - rect.bottom)),
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

const {
  jobs,
  libraries,
  error: jobsError,
  progress: jobProgress,
  cancelling,
  cancel: cancelJob,
} = useActiveJobs(toRef(props, 'visible'))
const shownJobs = jobs
const libraryName = (id: number): string =>
  libraries.value.find(lib => lib.id === id)?.name ?? `媒体库 ${id}`
const jobName = (type: string): string =>
  (
    ({
      scan: '扫描媒体库',
      parse: '解析媒体文件',
      fingerprint: '计算文件指纹',
      identify: '识别媒体',
      'writer-write': '写出媒体资料',
      'writer-organize': '整理文件',
      'writer-undo': '撤销整理',
      'writer-auto-organize': '自动整理文件',
      probe: '检测视频信息',
      'visual-frames': '提取画面',
    }) as Record<string, string>
  )[type] ?? `媒体库任务 · ${type}`

/** 标题旁的「N 项进行中」：识别、去码、未出错的边跑边看 */
const runningCount = computed(
  () =>
    shownJobs.value.length +
    Number(restoreRunning.value) +
    Number(hasLive.value && !liveFailed.value)
)

useEscapeLayer(
  () => props.visible,
  () => emit('close')
)
</script>

<style scoped src="./background-tasks-panel.css"></style>
