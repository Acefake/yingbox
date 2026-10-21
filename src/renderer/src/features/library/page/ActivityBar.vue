<template>
  <!-- 后台任务：一条细进度线 + 状态文字 -->
  <div class="lib-activity" :class="{ 'is-on': activity }" aria-live="polite">
    <template v-if="activity">
      <div class="lib-activity-track">
        <div
          class="lib-activity-fill"
          :class="{ 'is-indeterminate': activity.progress === undefined }"
          :style="
            activity.progress === undefined
              ? undefined
              : { transform: `scaleX(${activity.progress})` }
          "
        />
      </div>
      <span class="lib-activity-label">{{ activity.label }}</span>
    </template>
  </div>
</template>

<script setup lang="ts">
/** 媒体库页面的后台任务条：有进度时按比例填充，没有进度时来回滚动。没有任务时收起。 */
defineProps<{
  activity: { label: string; progress?: number } | null
}>()
</script>

<style scoped>
.lib-activity {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: 0;
  padding: 0 var(--content-padding-x);
  overflow: hidden;
  transition: height var(--duration-normal) var(--ease-out);
}
.lib-activity.is-on {
  height: 28px;
}
.lib-activity-track {
  position: relative;
  flex: 0 0 160px;
  height: 3px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
}
.lib-activity-fill {
  position: absolute;
  inset: 0;
  background: var(--accent);
  transform-origin: left center;
  transition: transform var(--duration-slow) var(--ease-out);
}
.lib-activity-fill.is-indeterminate {
  width: 40%;
  animation: lib-indeterminate var(--duration-pulse) var(--ease-out) infinite;
}
@keyframes lib-indeterminate {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
.lib-activity-label {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
</style>
