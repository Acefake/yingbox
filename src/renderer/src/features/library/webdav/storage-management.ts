import { h } from 'vue'
import { confirmDialog, toast } from '@/components/ui'
import type { WebDavSourceInfo } from '../../../../../shared/contract/webdav'
import { libraryBridge } from '../api/bridge'
import { newLibraryShape } from '../state/library-section'
import WebDavSourceForm from './WebDavSourceForm.vue'
import WebDavFolderPicker from './WebDavFolderPicker.vue'
import { webdavApi } from './webdav-api'
import {
  type SourceForm,
  librariesUsing,
  remoteLibraryTarget,
  sourceFormError,
  sourceInput,
} from './webdav-rules'

/** 存储页可用的 WebDAV 管理能力；网页端未接入该域时为 null。 */
export const storageWebDav = webdavApi()

/** 使用片库共用表单，确认连接可用后保存加密凭据。 */
export function editStorageWebDav(source?: WebDavSourceInfo): Promise<boolean> {
  let form: SourceForm | null = null
  return confirmDialog({
    title: source ? `编辑「${source.name}」` : '添加 WebDAV',
    width: 440,
    okText: '连接并保存',
    content: () =>
      h(WebDavSourceForm, {
        source,
        onChange: (next: SourceForm) => {
          form = next
        },
      }),
    onOk: async () => {
      if (!form || !storageWebDav) throw new Error('WebDAV 需要桌面端')
      const problem = sourceFormError(form)
      if (problem) throw new Error(problem)
      const input = sourceInput(form)
      const result = await storageWebDav.test(input)
      if (!result.ok) throw new Error(result.message)
      await storageWebDav.save(input)
    },
  })
}

/** 使用中的 WebDAV 源须先解除片库引用；移除操作不删除远端文件。 */
export async function removeStorageWebDav(
  source: WebDavSourceInfo
): Promise<boolean> {
  const bridge = libraryBridge()
  if (!bridge || !storageWebDav) throw new Error('WebDAV 需要桌面端')
  const using = librariesUsing(await bridge.listLibraries(), source.id)
  if (using.length)
    throw new Error(
      `请先移除使用此存储的片库：${using.map(item => item.name).join('、')}`
    )
  return confirmDialog({
    title: `移除「${source.name}」？`,
    content: '只移除连接与保存的凭据，不删除远端文件。',
    okText: '移除',
    danger: true,
    onOk: () => storageWebDav!.remove(source.id),
  })
}

/** 浏览源内目录，选定后添加为自动识别的普通片库。 */
export function addStorageWebDavLibrary(
  source: WebDavSourceInfo
): Promise<boolean> {
  let picked: { source: WebDavSourceInfo; path: string } | null = null
  return confirmDialog({
    title: `选择「${source.name}」的媒体文件夹`,
    width: 480,
    okText: '添加到媒体库',
    content: () =>
      h(WebDavFolderPicker, {
        sources: [source],
        onSelect: (next: typeof picked) => {
          picked = next
        },
      }),
    onOk: async () => {
      const bridge = libraryBridge()
      if (!picked || !bridge) throw new Error('请先选择可读取的文件夹')
      const target = remoteLibraryTarget(picked.source, picked.path)
      const library = await bridge.addLibrary({
        ...target,
        ...newLibraryShape('movie'),
      })
      toast.success(`已添加「${library.name}」，正在扫描`)
    },
  })
}

/** 把系统已认证的共享目录加入自动识别的普通片库。 */
export async function addStorageMountLibrary(
  path: string,
  name: string
): Promise<void> {
  const bridge = libraryBridge()
  if (!bridge) throw new Error('添加共享媒体库需要桌面端')
  const library = await bridge.addLibrary({
    root: path,
    name,
    ...newLibraryShape('movie'),
  })
  toast.success(`已添加「${library.name}」，正在扫描`)
}
