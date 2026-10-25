<template>
  <section class="grab-panel" aria-label="洗版">
    <header class="grab-head">
      <div class="grab-head-text">
        <h2 class="grab-title">洗版</h2>
        <p class="grab-sub">{{ data ? upgradeSummary(data) : '' }}</p>
      </div>
      <UiSegmented
        :model-value="String(data?.target ?? 1080)"
        :options="TARGET_OPTIONS"
        label="洗版目标分辨率"
        size="sm"
        @update:model-value="value => setOptions({ target: targetOf(value) })"
      />
      <UiButton
        size="sm"
        variant="plain"
        icon="refresh"
        label="立即检查"
        :loading="data?.running"
        :disabled="!data?.enabled"
        @click="runNow"
      />
      <UiSwitch
        :model-value="data?.enabled ?? false"
        label="洗版开关"
        @update:model-value="enabled => setOptions({ enabled })"
      />
    </header>

    <p v-if="ov.error.value" class="grab-notice">{{ ov.error.value }}</p>
    <p
      v-else-if="data && data.enabled && upgradeNotice(data)"
      class="grab-notice"
    >
      {{ upgradeNotice(data) }}
    </p>

    <ul v-if="data?.entries.length" class="grab-list">
      <li v-for="entry in data.entries" :key="entry.key" class="grab-row">
        <div class="grab-row-head">
          <span class="grab-name" :title="entry.filePath">{{
            entryName(entry)
          }}</span>
          <span class="grab-meta"
            >现在 {{ resolutionText(entry.resolution) }}</span
          >
          <span
            class="grab-status"
            :data-tone="entry.status === 'found' ? 'accent' : undefined"
          >
            {{ UPGRADE_STATUS_LABEL[entry.status] }}
          </span>
          <UiButton
            v-if="entry.status === 'replaced'"
            size="sm"
            variant="plain"
            icon="trash"
            label="删旧文件"
            @click="deleteOld(entry)"
          />
          <UiButton
            v-if="entry.status === 'found' || entry.status === 'waiting'"
            size="sm"
            variant="plain"
            label="不洗"
            @click="ignore(entry.key)"
          />
          <UiButton
            v-if="entry.status === 'waiting' && entry.error"
            size="sm"
            variant="plain"
            label="重新搜"
            @click="retry(entry.key)"
          />
        </div>
        <p v-if="entry.error" class="grab-meta">{{ entry.error }}</p>
        <p v-else-if="entry.status === 'replaced'" class="grab-meta">
          新文件「{{ entry.savedName }}」已在同一文件夹，旧文件还在
        </p>
        <template v-if="entry.status === 'found'">
          <div
            v-for="(cand, index) in entry.candidates"
            :key="cand.fileId"
            class="grab-cand"
          >
            <div class="grab-cand-main">
              <span class="grab-cand-file" :title="cand.fileName">{{
                cand.fileName
              }}</span>
              <span class="grab-meta">{{ candidateMeta(cand) }}</span>
            </div>
            <UiButton
              size="sm"
              variant="primary"
              label="替换"
              :loading="busy === `${entry.key}#${index}`"
              :disabled="busy !== null"
              @click="replace(entry.key, index)"
            />
          </div>
        </template>
        <div v-if="picking?.key === entry.key" class="grab-picker">
          <p class="grab-meta">
            认不出旧文件在 115 上的文件夹，选一下它所在的文件夹：
          </p>
          <NetdiskFolderPicker
            start-cid="0"
            @pick="dir => pickFolder(dir.cid)"
          />
        </div>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * 洗版面板：开关、目标分辨率（1080p / 4K）、立即检查；列出有更清楚版本的文件和候选，点「替换」
 * 把新文件存进旧文件所在的 115 文件夹（旧文件保留），之后可手动「删旧文件」（会先确认）。
 * 认不出 115 文件夹时就地展开文件夹选择器。
 */
import { computed, ref } from 'vue'

import { confirmDialog } from '@/components/ui'
import UiButton from '@/components/ui/UiButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { NetdiskFolderPicker } from '@/features/netdisk'
import type {
  UpgradeEntry,
  UpgradeOptionsPatch,
} from '../../../../../shared/contract/autograb-upgrade'

import { upgradeApi } from '../api'
import {
  TARGET_OPTIONS,
  UPGRADE_STATUS_LABEL,
  candidateMeta,
  entryName,
  resolutionText,
  targetOf,
  upgradeNotice,
  upgradeSummary,
} from '../upgrade-rules'
import { useOverview } from '../use-overview'

const ov = useOverview(upgradeApi())
const data = computed(() => ov.data.value)
const busy = ref<string | null>(null)
const picking = ref<{ key: string; index: number } | null>(null)

async function setOptions(patch: UpgradeOptionsPatch): Promise<void> {
  await upgradeApi().setOptions(patch)
  ov.refresh()
}

async function runNow(): Promise<void> {
  await upgradeApi().runNow()
  ov.refresh()
}

async function replace(
  key: string,
  index: number,
  cid?: string
): Promise<void> {
  busy.value = `${key}#${index}`
  try {
    const result = await upgradeApi().replace(key, index, cid)
    if (!result.ok && 'needFolder' in result) {
      picking.value = { key, index }
      ov.refresh()
      return
    }
    picking.value = null
    ov.report(result, '已转存到旧文件所在的文件夹')
  } finally {
    busy.value = null
  }
}

function pickFolder(cid: string): void {
  if (picking.value) void replace(picking.value.key, picking.value.index, cid)
}

async function ignore(key: string): Promise<void> {
  await upgradeApi().ignore(key)
  ov.refresh()
}

async function retry(key: string): Promise<void> {
  await upgradeApi().retry(key)
  ov.refresh()
}

async function deleteOld(entry: UpgradeEntry): Promise<void> {
  const ok = await confirmDialog({
    title: '删掉旧文件？',
    content: `「${entry.filePath}」会从网盘里删除，新文件「${entry.savedName ?? ''}」保留。`,
    okText: '删除',
    danger: true,
  })
  if (ok) ov.report(await upgradeApi().deleteOld(entry.key), '旧文件已删除')
}
</script>

<style scoped src="./grab-panel.css"></style>
