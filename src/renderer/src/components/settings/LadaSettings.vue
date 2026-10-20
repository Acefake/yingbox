<template>
  <p class="lada-intro">
    影盒只负责调度：实际修复由外部工具 lada
    完成（AGPL-3.0，需另行安装）。下面两项会自动探测，也可手动指定。
  </p>
  <SettingsGroup :footer="ladaHint || undefined">
    <SettingsRow
      v-for="tool in tools"
      :key="tool.key"
      :title="tool.title"
      stacked
    >
      <div class="lada-path">
        <UiInput
          :value="tool.path.value"
          class="lada-field"
          :aria-label="`${tool.title} 路径`"
          placeholder="未找到，请点右侧选择"
          readonly
        />
        <UiIconButton
          icon="folder"
          variant="secondary"
          :label="`选择 ${tool.title}…`"
          @click="tool.pick"
        />
        <UiButton
          size="sm"
          label="自动"
          :title="`恢复自动探测 ${tool.title}`"
          @click="resetLadaPath(tool.key)"
        />
      </div>
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 去马赛克（lada）：lada-cli 与 ffmpeg 的路径。
 * 打开分区时自动探测；手动选择或恢复自动后由主进程持久化（window.api.lada）。
 */
import { onMounted, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'

import SettingsGroup from './SettingsGroup.vue'
import SettingsRow from './SettingsRow.vue'

const ladaCli = ref('')
const ladaFfmpeg = ref('')
const ladaHint = ref('')

async function loadLadaPaths(): Promise<void> {
  if (!window.api?.lada?.paths) return
  try {
    const paths = await window.api.lada.paths()
    ladaCli.value = paths.cli
    ladaFfmpeg.value = paths.ffmpeg
    ladaHint.value = !paths.cli
      ? '未探测到 lada-cli：请先安装 lada，或手动选择 lada-cli.exe'
      : paths.cliOverridden
        ? 'lada-cli：使用手动指定的路径'
        : 'lada-cli：已自动探测。修复产物为同目录的 .restored.mp4，播放时会优先选它。'
  } catch (e) {
    ladaHint.value = (e as Error).message
  }
}

async function applyLadaPaths(changes: {
  cli?: string
  ffmpeg?: string
}): Promise<void> {
  try {
    await window.api.lada.setPaths(changes)
    await loadLadaPaths()
  } catch (e) {
    ladaHint.value = (e as Error).message
  }
}

async function pickLadaCli(): Promise<void> {
  const res = await window.api.dialog.openFile({
    title: '选择 lada-cli.exe',
    properties: ['openFile'],
    filters: [{ name: 'lada-cli', extensions: ['exe'] }],
  })
  if (res?.filePaths?.[0]) await applyLadaPaths({ cli: res.filePaths[0] })
}

async function pickFfmpeg(): Promise<void> {
  const res = await window.api.dialog.openFile({
    title: '选择 ffmpeg.exe',
    properties: ['openFile'],
    filters: [{ name: 'ffmpeg', extensions: ['exe'] }],
  })
  if (res?.filePaths?.[0]) await applyLadaPaths({ ffmpeg: res.filePaths[0] })
}

async function resetLadaPath(which: 'cli' | 'ffmpeg'): Promise<void> {
  await applyLadaPaths(which === 'cli' ? { cli: '' } : { ffmpeg: '' })
}

const tools = [
  { key: 'cli', title: 'lada-cli', path: ladaCli, pick: pickLadaCli },
  { key: 'ffmpeg', title: 'ffmpeg', path: ladaFfmpeg, pick: pickFfmpeg },
] as const

onMounted(loadLadaPaths)
</script>

<style scoped>
.lada-path {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.lada-field {
  flex: 1;
  min-width: 0;
}
.lada-intro {
  margin: 0 0 var(--space-4);
  padding: 0 var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
</style>
