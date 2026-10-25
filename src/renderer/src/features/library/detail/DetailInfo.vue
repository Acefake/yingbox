<template>
  <!-- 信息与文件 -->
  <section class="lib-section lib-info">
    <div v-if="infoRows.length" class="lib-info-block">
      <h2 class="lib-section-title">信息</h2>
      <dl class="lib-info-list">
        <template v-for="row in infoRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>
    </div>
    <div class="lib-info-block">
      <h2 class="lib-section-title">文件</h2>
      <ul class="lib-files">
        <li v-for="{ file, tag } in rows" :key="file.id" class="lib-file">
          <div class="lib-file-text">
            <div class="lib-file-name" :title="file.path">
              {{ baseName(file.path) }}
            </div>
            <div class="lib-file-meta">
              <span v-if="tag" class="lib-file-range">
                <UiSpecBadge v-bind="tag.spec" />
                <span v-if="tag.profile">{{ tag.profile }}</span>
              </span>
              <span class="lib-file-where"
                >{{ formatBytes(file.size) }} · {{ dirName(file.path) }}</span
              >
            </div>
          </div>
          <UiButton
            icon="externalLink"
            size="sm"
            label="在文件夹中显示"
            @click="reveal(file.path)"
          />
        </li>
        <li v-if="!files.length" class="lib-file-empty">没有视频文件</li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
/** 详情里的信息与文件区块：信息表（原名、上映、编剧……），视频文件列表（含 HDR / 杜比视界小标）与「在文件夹中显示」。 */
import { computed } from 'vue'

import type { LibraryItemFile } from '../../../../../shared/library/ipc'
import { videoProbeSpec } from '@/components/ui/spec-badge'
import UiButton from '@/components/ui/UiButton.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'

import { baseName, dirName, formatBytes } from '../shared/format'

const props = defineProps<{
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
.lib-info {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-8);
}
.lib-info-list {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--space-2) var(--space-5);
  margin: 0;
  font-size: var(--text-sm);
}
.lib-info-list dt {
  color: var(--text-tertiary);
}
.lib-info-list dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-word;
}
.lib-file-range {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-semibold);
  color: var(--text-secondary);
}
.lib-file-where {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lib-files {
  margin: 0;
  padding: 0;
  list-style: none;
}
.lib-file {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
}
.lib-file + .lib-file {
  border-top: 1px solid var(--separator);
}
.lib-file-text {
  flex: 1 1 auto;
  min-width: 0;
}
.lib-file-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-file-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-0_5);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  white-space: nowrap;
}
.lib-file-empty {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
