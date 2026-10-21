<template>
  <div class="amane-table-wrap">
    <table class="amane-table">
      <thead>
        <tr>
          <th>文件</th>
          <th>番号</th>
          <th>状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="file in files" :key="file.id">
          <td class="amane-file-path">{{ file.path }}</td>
          <td>
            <UiInput
              :model-value="numbers[file.id]"
              :placeholder="file.number || '输入番号'"
              :aria-label="`文件 ${file.id} 的番号`"
              @update:model-value="
                emit('number', file.id, String($event ?? ''))
              "
            />
          </td>
          <td>{{ statusNames[file.status] || file.status }}</td>
          <td>
            <div class="amane-row-actions">
              <UiIconButton
                icon="play"
                label="播放"
                size="sm"
                @click="emit('play', file.id)"
              />
              <UiIconButton
                icon="livePlay"
                label="边跑边看"
                size="sm"
                :disabled="busy || liveBusy || restoreRunning"
                @click="emit('live', file.id)"
              />
              <UiIconButton
                icon="sparkle"
                label="去码"
                size="sm"
                :disabled="busy || restoreRunning"
                @click="emit('restore', file.id)"
              />
              <UiIconButton
                icon="range"
                label="去码一段"
                size="sm"
                :disabled="busy || restoreRunning"
                @click="emit('range', file.id)"
              />
              <UiIconButton
                icon="download"
                label="刮削"
                size="sm"
                @click="emit('scrape', file)"
              />
              <UiIconButton
                icon="folder"
                label="整理：按模板把这条搬进子目录，并写出封面/海报"
                size="sm"
                :disabled="busy"
                @click="emit('organize', file.id)"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!files.length" class="amane-empty">
      暂无关联文件，请先扫描媒体库。
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * 文件视图：每个媒体文件的番号可就地改写后刮削；播放、边跑边看、去码、区间去码、整理。
 * 改写中的番号由父级保管（切换视图后仍在）。
 */
import { UiIconButton, UiInput } from '@/components/ui'
import { type AmaneFile, statusNames } from '../../api/amane'

defineProps<{
  files: AmaneFile[]
  /** 文件 id → 改写中的番号 */
  numbers: Record<number, string>
  busy: boolean
  liveBusy: boolean
  restoreRunning: boolean
}>()
const emit = defineEmits<{
  play: [id: number]
  live: [id: number]
  restore: [id: number]
  range: [id: number]
  scrape: [file: AmaneFile]
  number: [id: number, value: string]
  organize: [id: number]
}>()
</script>
