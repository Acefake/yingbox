<template>
  <SettingsGroup
    title="按分类存到不同文件夹"
    footer="动漫、综艺、纪录片可以各自存到自己的文件夹；没设的分类用上面的剧集默认目录，单独选过文件夹的剧不受影响。"
  >
    <SettingsRow
      v-for="category in CATEGORIES"
      :key="category"
      :title="SERIES_CATEGORY_LABEL[category]"
    >
      <TargetFolderPill
        :folder="folderOf(category)"
        :presets="presets"
        :active="folders[category] ? null : 'default'"
        prefix="存到"
        size="sm"
        align="right"
        @pick="pick => choose(category, pick)"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 自动追更里「按分类存到不同文件夹」：动漫 / 综艺 / 纪录片各一个默认转存目录（剧集用上面的剧集默认目录）。
 * 存在追更服务里（autograb.setCategoryFolder），桌面与 NAS 同一份；选「沿用剧集默认目录」清掉。
 */
import { computed, onMounted, ref } from 'vue'

import { toast } from '@/components/ui/toast'
import { autograbApi } from '@/features/autograb'
import { type FolderPick, TargetFolderPill } from '@/features/netdisk'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import {
  SERIES_CATEGORY_LABEL,
  type SeriesCategory,
} from '../../../../../shared/contract/series-category'
import {
  ROOT_FOLDER,
  type TargetFolder,
  folderOf as toFolder,
} from '../../../../../shared/netdisk/target-folder'

const CATEGORIES: SeriesCategory[] = ['anime', 'variety', 'documentary']

const folders = ref<Partial<Record<SeriesCategory, TargetFolder>>>({})
/** 剧集默认目录（没设分类目录时存到这里） */
const fallback = ref<TargetFolder>(ROOT_FOLDER)

const presets = computed(() => [
  {
    key: 'default',
    label: '沿用剧集默认目录',
    icon: 'tv' as const,
    folder: fallback.value,
  },
])

function folderOf(category: SeriesCategory): TargetFolder {
  return folders.value[category] ?? fallback.value
}

async function load(): Promise<void> {
  const overview = await autograbApi().overview()
  fallback.value = toFolder(
    overview.defaultFolder.cid,
    overview.defaultFolder.name
  )
  const next: Partial<Record<SeriesCategory, TargetFolder>> = {}
  for (const [name, folder] of Object.entries(overview.categoryFolders ?? {}))
    next[name as SeriesCategory] = toFolder(folder.cid, folder.name)
  folders.value = next
}

async function choose(
  category: SeriesCategory,
  pick: FolderPick
): Promise<void> {
  const folder = 'folder' in pick ? pick.folder : null
  try {
    await autograbApi().setCategoryFolder(
      category,
      folder?.cid ?? '',
      folder ? folder.name || '根目录' : ''
    )
    await load()
  } catch (e) {
    toast.error((e as Error).message)
  }
}

onMounted(() => void load().catch(() => {}))
</script>
