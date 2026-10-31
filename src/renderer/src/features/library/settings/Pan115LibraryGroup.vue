<template>
  <SettingsGroup
    title="115 网盘目录"
    footer="将 115 目录添加到当前片库后，可扫描、刮削和播放。浏览器需支持影片的编码格式。"
  >
    <SettingsRow
      title="已登录的 115 网盘"
      description="使用设置 · 网盘中的账号，可选择已添加的电影或剧集目录"
    >
      <UiButton
        size="sm"
        icon="plus"
        label="添加 115 文件夹…"
        :loading="adding"
        @click="add(false)"
      />
      <UiButton
        size="sm"
        icon="plus"
        label="添加 115 混合文件夹…"
        :loading="adding"
        @click="add(true)"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
import { h, ref } from 'vue'
import { UiButton, confirmDialog, toast } from '@/components/ui'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import { FolderTree } from '@/features/netdisk'
import type { TargetFolder } from '../../../../../shared/netdisk/target-folder'
import { remotePath } from '../../../../../shared/webdav/remote-path'
import { errorText, libraryBridge } from '../api/bridge'
import { type LibrarySection, SECTIONS } from '../state/library-section'

const props = defineProps<{ section: LibrarySection }>()
const adding = ref(false)

async function add(mixed: boolean): Promise<void> {
  let selected: TargetFolder | null = null
  await confirmDialog({
    title: '选择 115 片库目录',
    width: 480,
    okText: '添加并扫描',
    content: () =>
      h(FolderTree, {
        onSelect: (folder: TargetFolder) => {
          selected = folder
        },
      }),
    onOk: async () => {
      if (!selected) throw new Error('请先选择 115 文件夹')
      adding.value = true
      try {
        const { kind, source } = SECTIONS[props.section]
        await libraryBridge()!.addLibrary({
          root: remotePath('pan115', `/${selected.cid}`),
          name: selected.name || '115 根目录',
          kind,
          source,
          mixed,
          automation: { storage: 'cloud' },
        })
        toast.success('已添加 115 文件夹，正在扫描')
      } catch (error) {
        throw new Error(errorText(error))
      } finally {
        adding.value = false
      }
    },
  })
}
</script>
