<template>
  <LibrarySheet
    :open="open"
    :title="title"
    icon="plus"
    glass
    raised
    @close="close"
  >
    <!-- 第一步：选来源 -->
    <div v-if="step === 'pick'" class="source-groups">
      <section v-for="group in groups" :key="group.name" class="source-group">
        <h3 class="source-group__title">{{ group.name }}</h3>
        <ul class="source-group__list">
          <li v-for="spec in group.items" :key="spec.kind">
            <UiListRow :disabled="busy" @click="pick(spec.kind)">
              <template #leading><UiIcon :name="spec.icon" /></template>
              {{ spec.title }}
              <template #description>{{ spec.description }}</template>
            </UiListRow>
          </li>
        </ul>
      </section>
    </div>

    <!-- 115：选目录 -->
    <FolderTree
      v-else-if="step === 'pan115'"
      :selected-cid="panFolder?.cid"
      @select="onPanSelect"
    />

    <!-- WebDAV / Alist：新增服务器表单，或浏览文件夹 -->
    <WebDavSourceForm v-else-if="davMode === 'form'" @change="onFormChange" />
    <WebDavFolderPicker
      v-else
      :key="davSources.map(s => s.id).join(',')"
      :sources="davSources"
      @select="onDavSelect"
    />

    <template v-if="step !== 'pick'" #footer>
      <UiButton
        v-if="step === 'webdav' && davMode === 'browse'"
        size="sm"
        variant="plain"
        label="添加新服务器…"
        @click="davMode = 'form'"
      />
      <span class="source-footer__spacer" />
      <UiButton size="sm" label="返回" :disabled="busy" @click="backFromStep" />
      <UiButton
        v-if="step === 'webdav' && davMode === 'form'"
        size="sm"
        variant="primary"
        label="保存"
        :loading="busy"
        :disabled="Boolean(formProblem)"
        @click="saveServer"
      />
      <UiButton
        v-else
        size="sm"
        variant="primary"
        :label="step === 'pan115' ? '添加并扫描' : '添加到媒体库'"
        :loading="busy"
        :disabled="!canAdd"
        @click="addPicked"
      />
    </template>
  </LibrarySheet>
</template>

<script setup lang="ts">
/**
 * 媒体库「添加来源」面板：先选来源（本地文件夹 / 115 网盘 / WebDAV·Alist，当前端用不了的不列出），
 * 再走各自的流程——本地沿用系统选目录，115 选网盘目录，WebDAV 先选或新增服务器再浏览文件夹。
 * 添加成功后触发 added 并关闭；番号库不走这里。
 */
import { computed, ref, watch } from 'vue'

import { UiButton, UiIcon, UiListRow, toast } from '@/components/ui'
import { FolderTree } from '@/features/netdisk'
import { isWebRuntime } from '@/services/library-server'

import type { LibraryInfo } from '../../../../../shared/library/ipc'
import type { TargetFolder } from '../../../../../shared/netdisk/target-folder'
import type { WebDavSourceInfo } from '../../../../../shared/contract/webdav'
import { remotePath } from '../../../../../shared/webdav/remote-path'
import { errorText, libraryBridge } from '../api/bridge'
import LibrarySheet from '../shared/LibrarySheet.vue'
import { type LibrarySection, newLibraryShape } from '../state/library-section'
import WebDavFolderPicker from '../webdav/WebDavFolderPicker.vue'
import WebDavSourceForm from '../webdav/WebDavSourceForm.vue'
import { webdavApi } from '../webdav/webdav-api'
import {
  type SourceForm,
  remoteLibraryTarget,
  sourceFormError,
  sourceInput,
} from '../webdav/webdav-rules'

import {
  type SourceKind,
  availableSourceKinds,
  groupSourceKinds,
} from './source-kinds'

type Step = 'pick' | SourceKind
type DavMode = 'browse' | 'form'

const props = defineProps<{
  open: boolean
  section: LibrarySection
  /** 添加本地文件夹（useLibraries.addFolder）；取消返回 null */
  addLocal: () => Promise<LibraryInfo | null>
}>()
const emit = defineEmits<{ close: []; added: [library: LibraryInfo] }>()

const groups = computed(() =>
  groupSourceKinds(
    availableSourceKinds({
      local: Boolean(libraryBridge()),
      pan115: isWebRuntime() || Boolean(window.api?.pan115),
      webdav: Boolean(webdavApi()),
    })
  )
)

const step = ref<Step>('pick')
const busy = ref(false)
const davMode = ref<DavMode>('browse')
const davSources = ref<WebDavSourceInfo[]>([])
const panFolder = ref<TargetFolder | null>(null)
const davPicked = ref<{ source: WebDavSourceInfo; path: string } | null>(null)
const davForm = ref<SourceForm | null>(null)

const title = computed(() => {
  if (step.value === 'pan115') return '选择 115 文件夹'
  if (step.value === 'webdav')
    return davMode.value === 'form' ? '添加服务器' : '选择 WebDAV 文件夹'
  return '添加来源'
})
const formProblem = computed(() =>
  davForm.value ? sourceFormError(davForm.value) : '请填写地址'
)
const canAdd = computed(() =>
  step.value === 'pan115' ? Boolean(panFolder.value) : Boolean(davPicked.value)
)

watch(
  () => props.open,
  open => {
    if (!open) return
    step.value = 'pick'
    busy.value = false
    panFolder.value = null
    davPicked.value = null
    davForm.value = null
  }
)

function close(): void {
  if (!busy.value) emit('close')
}

function finish(library: LibraryInfo): void {
  toast.success(`已添加「${library.name}」，正在扫描`)
  emit('added', library)
  emit('close')
}

async function guardedRun(task: () => Promise<void>): Promise<void> {
  busy.value = true
  try {
    await task()
  } catch (error) {
    toast.error(errorText(error))
  } finally {
    busy.value = false
  }
}

async function pick(kind: SourceKind): Promise<void> {
  if (kind === 'local') {
    await guardedRun(async () => {
      const library = await props.addLocal()
      if (library) finish(library)
    })
    return
  }
  step.value = kind
  if (kind === 'webdav') await loadDavSources()
}

async function loadDavSources(): Promise<void> {
  await guardedRun(async () => {
    davSources.value = (await webdavApi()?.list()) ?? []
    davMode.value = davSources.value.length ? 'browse' : 'form'
  })
}

function backFromStep(): void {
  if (
    step.value === 'webdav' &&
    davMode.value === 'form' &&
    davSources.value.length
  ) {
    davMode.value = 'browse'
    return
  }
  step.value = 'pick'
}

function onPanSelect(folder: TargetFolder): void {
  panFolder.value = folder
}

function onDavSelect(selection: typeof davPicked.value): void {
  davPicked.value = selection
}

function onFormChange(form: SourceForm): void {
  davForm.value = { ...form }
}

async function saveServer(): Promise<void> {
  const form = davForm.value
  const api = webdavApi()
  if (!form || !api) return
  await guardedRun(async () => {
    await api.save(sourceInput(form))
    davSources.value = await api.list()
    davMode.value = 'browse'
    toast.success('已保存服务器')
  })
}

async function addPicked(): Promise<void> {
  const bridge = libraryBridge()
  if (!bridge) return
  await guardedRun(async () => {
    if (step.value === 'pan115') {
      const folder = panFolder.value
      if (!folder) throw new Error('请先选择 115 文件夹')
      finish(
        await bridge.addLibrary({
          root: remotePath('pan115', `/${folder.cid}`),
          name: folder.name || '115 根目录',
          ...newLibraryShape(props.section),
          automation: { storage: 'cloud' },
        })
      )
      return
    }
    const picked = davPicked.value
    if (!picked) throw new Error('请先进入要添加的文件夹')
    const { root, name } = remoteLibraryTarget(picked.source, picked.path)
    finish(
      await bridge.addLibrary({
        root,
        name,
        ...newLibraryShape(props.section),
      })
    )
  })
}
</script>

<style scoped>
.source-groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.source-group__title {
  margin: 0 0 var(--space-1);
  padding: 0 var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: 500;
}
.source-group__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.source-footer__spacer {
  flex: 1 1 auto;
}
</style>
