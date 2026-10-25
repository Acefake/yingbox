<template>
  <!-- 关于（效果图 D-3）：实色圆角卡片，左边片名、类型与完整简介，右边两列信息表；下面是视频文件卡 -->
  <section class="lib-section lib-about">
    <h2 class="lib-section-title">关于</h2>
    <div class="lib-about-card">
      <div class="lib-about-main">
        <h3 class="lib-about-title">{{ title }}</h3>
        <p v-if="kicker" class="lib-about-kicker">{{ kicker }}</p>
        <p v-if="overview" class="lib-about-overview">{{ overview }}</p>
      </div>
      <dl v-if="infoRows.length" class="lib-about-facts">
        <div v-for="row in infoRows" :key="row.label" class="lib-about-fact">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </div>

    <h2 class="lib-section-title lib-files-title">文件</h2>
    <ul class="lib-files">
      <li v-for="{ file, tag } in rows" :key="file.id">
        <UiPressable
          block
          class="lib-file"
          :label="`在文件夹中显示 ${baseName(file.path)}`"
          @click="reveal(file.path)"
        >
          <span class="lib-file-icon" aria-hidden="true"
            ><UiIcon name="movie" size="lg"
          /></span>
          <span class="lib-file-text">
            <span class="lib-file-name" :title="file.path">{{
              baseName(file.path)
            }}</span>
            <span class="lib-file-meta">
              <span v-if="tag" class="lib-file-range">
                <UiSpecBadge v-bind="tag.spec" />
                <span v-if="tag.profile">{{ tag.profile }}</span>
              </span>
              <span class="lib-file-where"
                >{{ formatBytes(file.size) }} · {{ dirName(file.path) }}</span
              >
            </span>
          </span>
          <UiIcon class="lib-file-go" name="externalLink" size="md" />
        </UiPressable>
      </li>
      <li v-if="!files.length" class="lib-file-empty">没有视频文件</li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * 详情里的「关于」区块（效果图 D-3）：实色圆角卡片，左边片名、类型行与完整简介，右边两列信息表
 * （原名、上映、编剧……）；下面是视频文件卡（效果图「如何观看」卡片的版式：图标块 + 文件名 + 动态范围小标、
 * 体积与所在文件夹），点卡片在文件夹中显示。
 */
import { computed } from 'vue'

import type { LibraryItemFile } from '../../../../../shared/library/ipc'
import { videoProbeSpec } from '@/components/ui/spec-badge'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'

import { baseName, dirName, formatBytes } from '../shared/format'

const props = defineProps<{
  /** 片名 */
  title: string
  /** 片名下的一行（类型 · 题材） */
  kicker: string
  /** 完整简介 */
  overview: string
  infoRows: Array<{ label: string; value: string }>
  files: LibraryItemFile[]
}>()

/** 文件行：动态范围标签在这里算一次 */
const rows = computed(() =>
  props.files.map(file => ({ file, tag: videoProbeSpec(file.video) }))
)

function reveal(path: string): void {
  void window.api?.shell?.openPath(dirName(path))
}
</script>

<style scoped src="./detail-section.css"></style>
<style scoped>
.lib-about {
  padding-bottom: calc(var(--space-11) + var(--space-9));
}
.lib-about-card {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6) var(--space-9);
  max-width: 1136px;
  padding: var(--space-6) var(--space-7) var(--space-7);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
}
.lib-about-main {
  flex: 1 1 360px;
  min-width: 0;
}
.lib-about-title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-bold); /* style-tokens: visual（卡片标题） */
}
.lib-about-kicker {
  margin: var(--space-0_5) 0 var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.lib-about-overview {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-md);
  line-height: 1.7;
  white-space: pre-line;
}
.lib-about-facts {
  display: grid;
  flex: 0 1 440px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3_5) var(--space-6);
  align-content: start;
  margin: 0;
  padding-top: var(--space-1);
}
.lib-about-fact dt {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}
.lib-about-fact dd {
  margin: var(--space-0_5) 0 0;
  color: var(--text-primary);
  font-size: var(--text-md);
  word-break: break-word;
}

/* —— 文件卡：两列，图标块 + 文字 + 打开 —— */
.lib-files-title {
  margin-top: var(--space-9);
}
.lib-files {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr));
  gap: var(--space-4);
  max-width: 1136px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.lib-file {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 96px;
  padding: 0 var(--space-5) 0 var(--space-3);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  text-align: left;
  transition: background var(--duration-fast) ease;
}
.lib-file:hover {
  background: var(--bg-fill-secondary);
}
.lib-file-icon {
  display: grid;
  flex: none;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: var(--radius-lg);
  background: var(--bg-content);
  color: var(--text-primary);
}
.lib-file-icon .app-icon {
  width: 30px;
  height: 30px;
}
.lib-file-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.lib-file-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-file-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.lib-file-range {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
}
.lib-file-where {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lib-file-go {
  flex: none;
  color: var(--text-tertiary);
}
.lib-file-empty {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
