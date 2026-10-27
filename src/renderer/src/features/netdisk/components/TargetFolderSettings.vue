<template>
  <SettingsGroup title="转存位置" :footer="FOOTER">
    <SettingsRow
      v-for="row in rows"
      :key="row.kind"
      :title="row.title"
      :description="row.description"
    >
      <TargetFolderPill
        :folder="row.folder"
        :presets="row.presets"
        :active="row.custom ? null : 'legacy'"
        prefix="存到"
        size="sm"
        align="right"
        :disabled="disabled"
        @pick="pick => choose(row.kind, pick)"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 网盘 · 转存位置：电影默认目录与剧集默认目录各一行，用转存目标胶囊选（最近使用 / 浏览 115 目录树）。
 * 没单独设时沿用原来的转存位置（pan115.targetCid），所以老配置打开就是原文件夹；胶囊里「沿用原转存位置」清掉单独设置。
 * 解析规则见 shared/netdisk/target-folder.ts。
 */
import { computed } from 'vue'

import { SettingsGroup, SettingsRow, useSetting } from '@/features/settings'
import {
  type TargetFolder,
  type TargetKind,
  defaultFolder,
  hasKindDefault,
  legacyFolder,
} from '../../../../../shared/netdisk/target-folder'

import { useTargetSettings } from '../composables/use-target-settings'
import type { FolderPick, FolderPreset } from '../utils/transfer-target'
import TargetFolderPill from './TargetFolderPill.vue'

defineProps<{ disabled: boolean }>()

const FOOTER =
  '网盘页按搜到的是电影还是剧集预选对应目录（没认出类型按电影）；追更没单独选文件夹的剧存到剧集目录；AI 助手、豆瓣卡「找 115 资源」与电影追踪存到电影目录。文件夹要在媒体库里（CloudDrive2 挂载），转存后才能自动入库。'

const settings = useTargetSettings(useSetting)
const fields = {
  movie: {
    cid: useSetting('pan115.movieCid'),
    name: useSetting('pan115.movieName'),
  },
  tv: { cid: useSetting('pan115.tvCid'), name: useSetting('pan115.tvName') },
}

const rows = computed(() =>
  (['movie', 'tv'] as const).map(kind => {
    const custom = hasKindDefault(kind, settings.value)
    const legacy = legacyFolder(settings.value)
    const presets: FolderPreset[] = [
      {
        key: 'legacy',
        label: '沿用原转存位置',
        icon: 'history',
        folder: legacy,
      },
    ]
    return {
      kind,
      title: kind === 'tv' ? '剧集默认目录' : '电影默认目录',
      description: custom ? undefined : '沿用原转存位置',
      folder: defaultFolder(kind, settings.value),
      custom,
      presets,
    }
  })
)

/** 选了文件夹：存成这个类型的默认目录；选「沿用原转存位置」：清掉单独设置 */
function choose(kind: TargetKind, pick: FolderPick): void {
  const folder: TargetFolder | null = 'folder' in pick ? pick.folder : null
  fields[kind].cid.value = folder?.cid ?? ''
  fields[kind].name.value = folder?.name ?? ''
}
</script>
