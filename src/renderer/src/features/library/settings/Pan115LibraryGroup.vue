<template>
  <SettingsGroup
    title="115 网盘目录"
    footer="将 115 目录添加到当前片库后，可扫描、刮削和播放。浏览器需支持影片的编码格式。"
  >
    <SettingsRow
      title="已登录的 115 网盘"
      description="使用设置 · 网盘中的账号，目录里的影片会自动分到电影、剧集、动漫等页面"
    >
      <UiButton
        size="sm"
        icon="plus"
        label="添加 115 文件夹…"
        :loading="adding"
        @click="add"
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
import { newLibraryShape } from '../state/library-section'
const adding = ref(false)

async function add(): Promise<void> {
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
        await libraryBridge()!.addLibrary({
          root: remotePath('pan115', `/${selected.cid}`),
          name: selected.name || '115 根目录',
          ...newLibraryShape('movie'),
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
