<template>
  <SettingsGroup title="WebDAV / Alist" :footer="REMOTE_FOOTER">
    <SettingsRow
      v-for="source in sources"
      :key="source.id"
      :title="source.name"
      :description="sourceDescription(source)"
    >
      <UiButton size="sm" label="编辑" @click="edit(source)" />
      <UiButton
        icon="trash"
        size="sm"
        variant="danger"
        label="删除源"
        @click="remove(source)"
      />
    </SettingsRow>
    <SettingsRow
      v-if="!sources.length"
      title="还没有远程源"
      description="添加 NAS 或 Alist 的 WebDAV 地址后，可以把上面的片子加进媒体库"
    />
    <SettingsRow>
      <UiButton size="sm" icon="plus" label="添加源…" @click="edit()" />
      <UiButton
        size="sm"
        variant="plain"
        label="添加 WebDAV 文件夹…"
        :disabled="!sources.length"
        @click="addFolder('movie')"
      />
      <UiButton
        v-if="jav"
        size="sm"
        variant="plain"
        label="添加为番号文件夹…"
        :disabled="!sources.length"
        @click="addFolder('jav')"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 媒体库设置里的 WebDAV / Alist 分组：管理远程源（地址、用户名、密码，可测试连接），
 * 以及把某个源里的文件夹添加为媒体库（根目录写成 yingbox-dav://<源 id>/<路径>）：默认是自动识别的
 * 普通片库，成人模式（jav）下也可添加为番号库。只在桌面端显示（见 LibraryGlobalSettings）：源和凭据在主进程，网页端的片库服务没有这个能力。
 */
import { confirmDialog, toast } from '@/components/ui'
import { h, ref } from 'vue'

import type { LibraryInfo } from '../../../../../shared/library/ipc'
import type { WebDavSourceInfo } from '../../../../../shared/contract/webdav'
import { SettingsGroup, SettingsRow } from '@/features/settings'
import UiButton from '@/components/ui/UiButton.vue'

import { errorText, libraryBridge } from '../api/bridge'
import { type LibrarySection, newLibraryShape } from '../state/library-section'
import WebDavFolderPicker from './WebDavFolderPicker.vue'
import WebDavSourceForm from './WebDavSourceForm.vue'
import { webdavApi } from './webdav-api'
import {
  REMOTE_FOOTER,
  type SourceForm,
  librariesUsing,
  remoteLibraryTarget,
  sourceDescription,
  sourceFormError,
  sourceInput,
} from './webdav-rules'

defineProps<{ jav?: boolean }>()

const api = webdavApi()!
const sources = ref<WebDavSourceInfo[]>([])

async function reload(): Promise<void> {
  try {
    sources.value = await api.list()
  } catch (error) {
    toast.error(errorText(error))
  }
}

/** 新建（不传）或编辑一个源。 */
function edit(source?: WebDavSourceInfo): void {
  let form: SourceForm | null = null
  void confirmDialog({
    title: source ? `编辑「${source.name}」` : '添加 WebDAV 源',
    width: 440,
    okText: '保存',
    content: () =>
      h(WebDavSourceForm, {
        source,
        onChange: (next: SourceForm) => (form = next),
      }),
    onOk: async () => {
      const problem = form ? sourceFormError(form) : '请填写地址'
      if (problem || !form) throw new Error(problem ?? '请填写地址')
      await api.save(sourceInput(form))
      await reload()
      toast.success('已保存')
    },
  })
}

async function confirmRemove(source: WebDavSourceInfo): Promise<void> {
  // 查全部分区的媒体库：电影、剧集、番号可能用着同一个源
  let all: LibraryInfo[] = []
  try {
    all = (await libraryBridge()?.listLibraries()) ?? []
  } catch (error) {
    toast.error(errorText(error))
    return
  }
  const using = librariesUsing(all, source.id)
  if (using.length) {
    toast.warning(
      `先在媒体库里移除使用这个源的文件夹：${using.map(l => l.name).join('、')}`
    )
    return
  }
  void confirmDialog({
    title: `删除「${source.name}」？`,
    content: '保存的地址和密码会一起删除。',
    okText: '删除',
    danger: true,
    onOk: async () => {
      await api.remove(source.id)
      await reload()
    },
  })
}

function remove(source: WebDavSourceInfo): void {
  void confirmRemove(source)
}

/** 选一个远程文件夹，添加为普通片库（movie）或番号库（jav）。 */
function addFolder(section: LibrarySection): void {
  const bridge = libraryBridge()
  if (!bridge) return
  let picked: { source: WebDavSourceInfo; path: string } | null = null
  void confirmDialog({
    title: '选择 WebDAV 文件夹',
    width: 480,
    okText: '添加',
    content: () =>
      h(WebDavFolderPicker, {
        sources: sources.value,
        onSelect: (next: typeof picked) => (picked = next),
      }),
    onOk: async () => {
      if (!picked) throw new Error('请先进入要添加的文件夹')
      const { root, name } = remoteLibraryTarget(picked.source, picked.path)
      const lib = await bridge.addLibrary({
        root,
        name,
        ...newLibraryShape(section),
      })
      toast.success(`已添加「${lib.name}」，正在扫描`)
    },
  })
}

void reload()
</script>
