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

        <!-- 媒体库识别 / 刷新元数据（跨电影、剧集、番号分区）；去码 / 边跑边看：主进程里的后台任务，只读展示并可停止 -->
        <div v-if="hasRuntime || identifying" class="sqp-runtime-body">
          <div
            v-if="identifying"
            class="sqp-row sqp-job is-processing"
            role="status"
            aria-live="polite"
          >
            <div class="sqp-status" aria-hidden="true">
              <span class="sqp-spin" />
            </div>
            <div class="sqp-info">
              <div class="sqp-name">媒体库 · {{ identifying.label }}</div>
              <div class="sqp-job-detail">
                <span class="sqp-job-track" aria-hidden="true">
                  <span
                    class="sqp-job-fill"
                    :style="{ width: `${identifyPercent}%` }"
                  />
                </span>
                <span class="sqp-job-value">{{ identifyPercent }}%</span>
              </div>
            </div>
          </div>

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
          <span>媒体库识别、去码、边跑边看开始后会显示在这里</span>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 后台任务浮层：从侧栏「后台任务」按钮上方弹出，展示媒体库识别进度、去码 / 边跑边看。
 * 任务状态在主进程 / 媒体库引擎里，这里只读展示，提供取消 / 停止 / 关闭；样式在 background-tasks-panel.css。
 */
import { computed, nextTick, ref, watch } from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useLadaTasks } from '@/features/lada'
import { useIdentifyActivity } from '@/features/library'

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

const identifying = useIdentifyActivity()
const identifyPercent = computed(() =>
  Math.round((identifying.value?.progress ?? 0) * 100)
)

useEscapeLayer(
  () => props.visible,
  () => emit('close')
)
</script>

<style scoped src="./background-tasks-panel.css"></style>
