<template>
  <LibrarySheet
    :open="open"
    title="整理文件"
    icon="folder"
    size="lg"
    @close="close"
  >
    <div v-if="stage.stage === 'previewing'" class="org-status">
      正在生成整理计划…
    </div>

    <div v-else-if="stage.stage === 'error'" class="org-status is-error">
      {{ stage.message }}
    </div>

    <template v-else-if="plan">
      <p class="org-summary">
        将按模板移动 <strong>{{ runnable }}</strong> 个文件<template
          v-if="crossDevice"
          >，其中 {{ crossDevice }} 个跨盘（复制后删除，较慢）</template
        ><template v-if="conflicts">；{{ conflicts }} 个有冲突，将跳过</template
        ><template v-if="plan.unchanged"
          >；{{ plan.unchanged }} 个已符合模板</template
        >。
      </p>
      <p v-if="!organizeEnabled" class="org-warning">
        整理默认关闭。请先在「设置 → 媒体库」中开启「允许整理文件」，才能执行。
      </p>
      <div class="org-table-wrap custom-scrollbar">
        <table class="org-table">
          <thead>
            <tr>
              <th>当前位置</th>
              <th aria-label="移动到" />
              <th>整理后</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(entry, i) in shownEntries"
              :key="i"
              :class="{ 'is-conflict': entry.conflict }"
            >
              <td :title="entry.from">
                <div class="org-name">{{ baseName(entry.from) }}</div>
                <div class="org-dir">{{ dirName(entry.from) }}</div>
              </td>
              <td class="org-arrow" aria-hidden="true">→</td>
              <td :title="entry.to">
                <div class="org-name">{{ baseName(entry.to) }}</div>
                <div class="org-dir">
                  {{ dirName(entry.to) }}
                  <span v-if="entry.crossDevice" class="org-tag">跨盘</span>
                </div>
                <div v-if="entry.conflict" class="org-conflict">
                  {{ entry.conflict }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="hiddenEntries > 0" class="org-more">
          另有 {{ hiddenEntries }} 项未显示
        </p>
      </div>
    </template>

    <div v-else-if="stage.stage === 'applied'" class="org-done">
      <UiIcon name="check" size="lg" />
      <p>已开始整理 {{ stage.moved }} 个文件。</p>
      <p class="org-done-hint">整理有误可以撤销，文件会移回原处。</p>
    </div>

    <div v-else-if="stage.stage === 'undoing'" class="org-status">
      正在撤销…
    </div>

    <div v-else-if="stage.stage === 'undone'" class="org-done">
      <UiIcon name="check" size="lg" />
      <p>已开始撤销，文件将移回原处。</p>
    </div>

    <template #footer>
      <template v-if="stage.stage === 'preview' || stage.stage === 'applying'">
        <UiButton label="取消" @click="close" />
        <UiButton
          variant="primary"
          label="执行整理"
          :loading="stage.stage === 'applying'"
          :disabled="!runnable || !organizeEnabled"
          @click="applyOrganize"
        />
      </template>
      <template v-else-if="stage.stage === 'applied'">
        <UiButton
          icon="back"
          label="撤销"
          @click="undoOrganize(stage.batchId)"
        />
        <UiButton variant="primary" label="完成" @click="close" />
      </template>
      <UiButton v-else variant="primary" label="完成" @click="close" />
    </template>
  </LibrarySheet>
</template>

<script setup lang="ts">
/**
 * 整理（改名移动）：打开即生成预览计划，表格确认后执行，执行后可撤销。
 * 冲突项在计划里标出、不会执行；整理未在设置里开启时只能预览。
 */
import { computed, watch } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'

import { baseName, dirName } from '../shared/format'
import LibrarySheet from '../shared/LibrarySheet.vue'
import { runnableCount, useWriter, useWriterSettings } from './use-writer'

const props = defineProps<{ open: boolean; itemIds: number[] }>()
const emit = defineEmits<{ close: [] }>()

/** 表格最多渲染的行数：计划可能上万项，确认时看前面一段就够了。 */
const MAX_ROWS = 500

const {
  organize: stage,
  previewOrganize,
  applyOrganize,
  undoOrganize,
  resetOrganize,
} = useWriter()
const { settings } = useWriterSettings()

watch(
  () => props.open,
  open => {
    if (open && props.itemIds.length) void previewOrganize(props.itemIds)
  },
  { immediate: true }
)

const plan = computed(() =>
  stage.value.stage === 'preview' || stage.value.stage === 'applying'
    ? stage.value.plan
    : null
)
const runnable = computed(() => (plan.value ? runnableCount(plan.value) : 0))
const conflicts = computed(
  () => plan.value?.entries.filter(e => e.conflict).length ?? 0
)
const crossDevice = computed(
  () =>
    plan.value?.entries.filter(e => e.crossDevice && !e.conflict).length ?? 0
)
const shownEntries = computed(
  () => plan.value?.entries.slice(0, MAX_ROWS) ?? []
)
const hiddenEntries = computed(
  () => (plan.value?.entries.length ?? 0) - shownEntries.value.length
)
const organizeEnabled = computed(() => settings.value.organize.enabled)

function close(): void {
  resetOrganize()
  emit('close')
}
</script>

<style scoped>
.org-status {
  display: grid;
  min-height: 200px;
  place-items: center;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
.org-status.is-error {
  color: var(--danger);
}
.org-summary {
  margin: 0 0 var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
.org-summary strong {
  color: var(--text-primary);
}
.org-warning {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
  color: var(--text-primary);
  font-size: var(--text-xs);
}
.org-table-wrap {
  max-height: 460px;
  overflow: auto;
  border-radius: var(--radius-lg);
  background: var(--bg-glass);
}
.org-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
  table-layout: fixed;
}
.org-table th {
  position: sticky;
  top: 0;
  padding: var(--space-2) var(--space-4);
  background: var(--bg-elevated);
  color: var(--text-tertiary);
  font-weight: var(--font-weight-medium);
  text-align: left;
}
.org-table th:nth-child(2),
.org-table td:nth-child(2) {
  width: 32px;
  padding: 0;
  text-align: center;
}
.org-table td {
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--separator);
  vertical-align: top;
}
.org-name {
  overflow: hidden;
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.org-dir {
  margin-top: var(--space-0_5);
  overflow: hidden;
  color: var(--text-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.org-arrow {
  color: var(--text-quaternary);
}
.org-tag {
  margin-left: var(--space-1);
  padding: 0 var(--space-1);
  border-radius: var(--radius-xs);
  background: var(--bg-fill-secondary);
  color: var(--text-secondary);
}
.is-conflict .org-name {
  color: var(--text-tertiary);
}
.org-conflict {
  margin-top: var(--space-1);
  color: var(--danger);
}
.org-more {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.org-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-9) 0;
  color: var(--text-primary);
  font-size: var(--text-sm);
}
.org-done p {
  margin: 0;
}
.org-done-hint {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
</style>
