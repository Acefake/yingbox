<template>
  <h2 class="match-local-title">
    {{ node.title }}
    <span v-if="node.year" class="match-local-year">{{ node.year }}</span>
  </h2>
  <ul class="match-files">
    <li v-for="name in files.shown" :key="name" :title="name">
      {{ name }}
    </li>
    <li v-if="files.more > 0" class="match-files-more">
      另有 {{ files.more }} 个文件
    </li>
  </ul>
  <div class="match-state">
    <span class="match-state-pill" :class="`is-${node.matchState}`">
      {{ MATCH_STATE_LABEL[node.matchState] }}
    </span>
    <span v-if="current" class="match-current">
      当前：{{ current.title
      }}<template v-if="current.year">（{{ current.year }}）</template>
    </span>
  </div>
</template>

<script setup lang="ts">
/** 匹配对照的本地一侧：条目标题与年份、视频文件名（最多 4 个）、匹配状态与当前匹配。 */
import { computed } from 'vue'

import type {
  LibraryItemNode,
  MatchCandidateInfo,
} from '../../../../../shared/library/ipc'
import { MATCH_STATE_LABEL } from '../shared/format'
import { clipFiles } from './match-rules'
import { localFileNames } from './use-match-review'

const props = defineProps<{
  node: LibraryItemNode
  current: MatchCandidateInfo | null
}>()

const files = computed(() => clipFiles(localFileNames(props.node)))
</script>

<style scoped>
.match-local-title {
  margin: 0 0 var(--space-3);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
}
.match-local-year {
  margin-left: var(--space-2);
  color: var(--text-tertiary);
  font-weight: var(--font-weight-regular);
}
.match-files {
  margin: 0 0 var(--space-3);
  padding: 0;
  list-style: none;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.8;
}
.match-files li {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.match-files-more {
  color: var(--text-tertiary);
  font-family: var(--font-sans);
}
.match-state {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.match-state-pill {
  padding: var(--space-0_5) var(--space-2);
  border-radius: var(--radius-xs);
  background: var(--bg-fill-secondary);
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
}
.match-state-pill.is-review {
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  color: var(--warning);
}
.match-state-pill.is-locked {
  background: var(--accent-soft);
  color: var(--accent-text);
}
</style>
