<template>
  <div class="amane-settings-section">
    <AmaneSettings
      ref="inner"
      :status="status"
      :initial-section="sub || 'connection'"
      @changed="status = $event"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * Amane 的设置分区：打开时取一次 Amane 状态交给 Amane 设置页，
 * 并把它的「有未保存修改」拦截暴露给设置面板。
 */
import { onMounted, ref } from 'vue'
import type { AmaneStatus } from '../../../../../shared/amane'
import AmaneSettings from './Settings.vue'

defineProps<{ sub?: string }>()

const inner = ref<InstanceType<typeof AmaneSettings> | null>(null)
const status = ref<AmaneStatus | null>(null)

onMounted(async () => {
  if (!window.api?.amane) return
  try {
    status.value = await window.api.amane.status()
  } catch {
    /* 连接错误由 Amane 设置页自己在界面上提示 */
  }
})

/** 有未保存修改时由 Amane 设置页确认；返回 false 表示留在原处 */
function canLeave(): boolean {
  return inner.value?.canLeave() !== false
}

defineExpose({ canLeave })
</script>

<style scoped>
/* ── Amane 分区自带二级导航：在设置窗口内去掉它自己的卡片外观 ── */
.amane-settings-section :deep(.amane-settings) {
  display: grid;
  grid-template-columns: minmax(150px, 190px) minmax(0, 1fr);
  align-items: start;
  gap: var(--space-6);
}

.amane-settings-section :deep(.amane-settings-nav) {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3) var(--space-1) 0;
  border: 0;
  border-right: 1px solid var(--separator);
  border-radius: 0;
}

.amane-settings-section :deep(.amane-config-settings.is-integrated) {
  display: block;
  padding: 0;
}

.amane-settings-section :deep(.amane-settings-nav .ui-nav-item) {
  min-height: 36px;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
}

.amane-settings-section :deep(.amane-config-panel) {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.amane-settings-section :deep(.amane-config-save) {
  position: static;
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  border-top: 1px solid var(--separator);
  background: transparent;
}

@media (max-width: 900px) {
  .amane-settings-section :deep(.amane-settings) {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-4);
  }

  .amane-settings-section :deep(.amane-settings-nav) {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--separator);
    padding: 0 0 var(--space-2);
  }

  .amane-settings-section :deep(.amane-settings-nav .ui-nav-item) {
    flex: 0 0 auto;
    white-space: nowrap;
  }
}
</style>
