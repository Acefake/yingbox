<template>
  <div class="gp-view">
    <header class="gp-toolbar">
      <p class="gp-state">
        <span
          class="gp-dot"
          :class="{ 'is-on': data?.enabled }"
          aria-hidden="true"
        />
        <span role="status" aria-live="polite">{{
          data ? upgradeSummary(data) : '正在读取洗版状态'
        }}</span>
        <UiLoadingDots v-if="!data || data.running" />
      </p>
      <UiButton
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

    <SettingsGroup v-if="notice" class="gp-needs">
      <SettingsRow>
        <template #description>
          <span class="gp-need">
            <UiIcon class="gp-need-icon" name="warning" size="sm" />{{ notice }}
          </span>
        </template>
        <UiButton
          v-if="needsNetdisk"
          size="sm"
          label="去设置"
          @click="openNetdiskSettings()"
        />
      </SettingsRow>
    </SettingsGroup>

    <GrabSection
      v-if="found.length && data"
      title="有更清楚的版本"
      :count="`${found.length} 个`"
    >
      <ul class="grab-tasks">
        <li v-for="entry in found" :key="entry.key">
          <GrabTaskCard
            :title="entryName(entry)"
            :subtitle="upgradeGap(entry, data)"
            state="有更清楚的"
            tone="pending"
            :candidate="entry.candidates[0] ?? null"
            :reason="
              picking?.key === entry.key ? '' : (entry.error ?? REPLACE_NOTE)
            "
          >
            <ul v-if="expanded.has(entry.key)" class="gp-cands">
              <li
                v-for="(cand, index) in entry.candidates.slice(1)"
                :key="cand.fileId"
                class="gp-cand"
              >
                <span class="gp-cand-main">
                  <span class="gp-cand-file" :title="cand.fileName">{{
                    cand.fileName
                  }}</span>
                  <span class="gp-meta">{{ candidateMeta(cand) }}</span>
                </span>
                <UiButton
                  size="sm"
                  label="替换"
                  :loading="busy === `${entry.key}#${index + 1}`"
                  :disabled="busy !== null"
                  @click="replace(entry.key, index + 1)"
                />
              </li>
            </ul>
            <div v-if="picking?.key === entry.key" class="gp-picker">
              <p class="gp-meta">
                认不出旧文件在 115 上的文件夹，选一下它所在的文件夹
              </p>
              <TargetFolderPill
                :folder="ROOT_FOLDER"
                prefix="旧文件在"
                size="sm"
                @pick="pickFolder"
              />
            </div>
            <template #actions>
              <UiButton
                v-if="entry.candidates.length > 1"
                class="ag-quiet"
                size="sm"
                variant="plain"
                :icon="expanded.has(entry.key) ? 'chevronUp' : 'chevronDown'"
                :label="`另 ${entry.candidates.length - 1} 个`"
                :aria-expanded="expanded.has(entry.key)"
                @click="toggle(entry.key)"
              />
              <UiButton
                class="ag-quiet"
                size="sm"
                variant="plain"
                label="不洗"
                @click="ignore(entry.key)"
              />
              <span class="ag-grow" />
              <UiButton
                size="sm"
                variant="primary"
                icon="download"
                label="替换"
                :loading="busy === `${entry.key}#0`"
                :disabled="busy !== null && busy !== `${entry.key}#0`"
                @click="replace(entry.key, 0)"
              />
            </template>
          </GrabTaskCard>
        </li>
      </ul>
    </GrabSection>

    <GrabSection
      v-if="replaced.length"
      title="新版已存好，旧文件还在"
      :count="`${replaced.length} 个`"
    >
      <SettingsGroup>
        <SettingsRow
          v-for="entry in replaced"
          :key="entry.key"
          :title="entryName(entry)"
          :description="`新文件「${entry.savedName ?? ''}」已在同一文件夹`"
        >
          <UiButton
            size="sm"
            icon="trash"
            label="删旧文件"
            @click="deleteOld(entry)"
          />
        </SettingsRow>
      </SettingsGroup>
    </GrabSection>

    <SettingsGroup v-if="others.length">
      <SettingsRow
        title="记录"
        :description="`${others.length} 个文件在等待搜索、已转存或不洗`"
      >
        <UiButton
          size="sm"
          :icon="othersOpen ? 'chevronUp' : 'chevronDown'"
          :label="othersOpen ? '收起' : '展开'"
          :aria-expanded="othersOpen"
          @click="othersOpen = !othersOpen"
        />
      </SettingsRow>
      <template v-if="othersOpen">
        <SettingsRow
          v-for="entry in others"
          :key="entry.key"
          :title="entryName(entry)"
          :description="otherNote(entry)"
        >
          <UiButton
            v-if="entry.status === 'waiting' && entry.error"
            class="ag-quiet"
            size="sm"
            variant="plain"
            label="重新搜"
            @click="retry(entry.key)"
          />
          <UiButton
            v-if="entry.status === 'waiting'"
            class="ag-quiet"
            size="sm"
            variant="plain"
            label="不洗"
            @click="ignore(entry.key)"
          />
        </SettingsRow>
      </template>
    </SettingsGroup>

    <p v-if="data?.enabled && !data.entries.length" class="gp-empty">
      {{ upgradeSummary(data) }}
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * 自动追更页「洗版」栏，与剧集栏同一套版式：一条工具栏（状态句是洗版概况，立即检查、开关），缺前置条件时一组玻璃分组；
 * 「有更清楚的版本」是卡片（GrabTaskCard：现在几 p、首选几 p、最佳候选），主按钮「替换」把新文件存进旧文件所在的 115 文件夹
 * （旧文件保留），认不出文件夹时卡片里就地选；「新版已存好，旧文件还在」一行一个「删旧文件」（会先确认）；
 * 其余（等待搜索、已转存、不洗）收在记录里。
 */
import { computed, reactive, ref } from 'vue'

import { confirmDialog } from '@/components/ui'
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiLoadingDots from '@/components/ui/UiLoadingDots.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { GrabSection, GrabTaskCard } from '@/features/autograb'
import {
  type FolderPick,
  TargetFolderPill,
  openNetdiskSettings,
} from '@/features/netdisk'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import type {
  UpgradeEntry,
  UpgradeOptionsPatch,
} from '../../../../../shared/contract/autograb-upgrade'
import { ROOT_FOLDER } from '../../../../../shared/netdisk/target-folder'

import { upgradeApi } from '../api'
import {
  UPGRADE_STATUS_LABEL,
  candidateMeta,
  entryName,
  upgradeFound,
  upgradeGap,
  upgradeNotice,
  upgradeOthers,
  upgradeReplaced,
  upgradeSummary,
} from '../upgrade-rules'
import { useOverview } from '../use-overview'

const REPLACE_NOTE = '替换会把新文件存进旧文件所在的 115 文件夹，旧文件先留着。'

const ov = useOverview(upgradeApi())
const data = computed(() => ov.data.value)
const found = computed(() => upgradeFound(data.value))
const replaced = computed(() => upgradeReplaced(data.value))
const others = computed(() => upgradeOthers(data.value))
const othersOpen = ref(false)
/** 展开了其它候选的条目 */
const expanded = reactive(new Set<string>())
const busy = ref<string | null>(null)
const picking = ref<{ key: string; index: number } | null>(null)

/** 读取出错，或开着洗版但缺前置条件 / 被暂停 */
const notice = computed(() => {
  if (ov.error.value) return ov.error.value
  const d = data.value
  return d?.enabled ? upgradeNotice(d) : null
})
const needsNetdisk = computed(
  () => !!data.value && (!data.value.ready.loggedIn || !data.value.ready.pansou)
)

function toggle(key: string): void {
  if (expanded.has(key)) expanded.delete(key)
  else expanded.add(key)
}

/** 记录里一行的说明：状态 + 原因 */
function otherNote(entry: UpgradeEntry): string {
  return [UPGRADE_STATUS_LABEL[entry.status], entry.error]
    .filter(Boolean)
    .join(' · ')
}

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

/** 在转存目标胶囊里选了旧文件所在的文件夹：带着它重新替换 */
function pickFolder(pick: FolderPick): void {
  if (!picking.value || !('folder' in pick)) return
  void replace(picking.value.key, picking.value.index, pick.folder.cid)
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
<style scoped>
.gp-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
</style>
