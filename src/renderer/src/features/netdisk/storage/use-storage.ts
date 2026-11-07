import { type ComputedRef, type Ref, computed, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type {
  StorageMount,
  StorageMountInput,
} from '../../../../../shared/contract/storage'
import type { WebDavSourceInfo } from '../../../../../shared/contract/webdav'
import { confirmDialog, toast } from '@/components/ui'
import type { MenuButtonItem } from '@/components/ui/UiMenuButton.vue'
import {
  addStorageMountLibrary,
  addStorageWebDavLibrary,
  editStorageWebDav,
  removeStorageWebDav,
  storageWebDav,
} from '@/features/library'
import {
  netdisk,
  netdiskAccount,
  netdiskAccountKnown,
  netdiskAvailable,
  refreshNetdiskAccount,
  setNetdiskAccount,
} from '../api'
import SmbMountForm from './SmbMountForm.vue'

/** 存储页每一行对应真实账号、WebDAV 源或系统共享。 */
export type StorageEntry =
  | { kind: '115'; id: string; name: string; description: string }
  | {
      kind: 'webdav'
      id: string
      name: string
      description: string
      source: WebDavSourceInfo
    }
  | {
      kind: 'smb'
      id: string
      name: string
      description: string
      source: StorageMount
    }

/** 管理存储列表与交互；列表失败保留已有数据，连接状态仅来自实际检查。 */
export function useStorage(): {
  entries: ComputedRef<StorageEntry[]>
  loading: Ref<boolean>
  error: Ref<string>
  checking: Ref<Record<string, boolean>>
  checked: Ref<Record<string, 'ok' | 'error'>>
  loginOpen: Ref<boolean>
  reload(): Promise<void>
  add(kind: StorageEntry['kind']): void
  open(entry: StorageEntry): void
  menu(entry: StorageEntry): MenuButtonItem[]
  mountsAvailable: boolean
  webdavAvailable: boolean
} {
  const router = useRouter()
  const mountsApi = window.api?.storage
  const sources = ref<WebDavSourceInfo[]>([])
  const mounts = ref<StorageMount[]>([])
  const loading = ref(false)
  const error = ref('')
  const checking = ref<Record<string, boolean>>({})
  const checked = ref<Record<string, 'ok' | 'error'>>({})
  const loginOpen = ref(false)
  const entries = computed<StorageEntry[]>(() => {
    const account = netdiskAccount.value
    return [
      ...(account?.loggedIn
        ? [
            {
              kind: '115' as const,
              id: '115',
              name: account.userName || '我的 115',
              description: '115 网盘 · 账号已登录',
            },
          ]
        : []),
      ...sources.value.map(source => ({
        kind: 'webdav' as const,
        id: `dav:${source.id}`,
        name: source.name,
        description: `WebDAV · ${source.url}`,
        source,
      })),
      ...mounts.value.map(source => ({
        kind: 'smb' as const,
        id: `smb:${source.id}`,
        name: source.name,
        description: `SMB · ${source.path}`,
        source,
      })),
    ]
  })

  async function reload(): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = ''
    const results = await Promise.allSettled([
      (async () => {
        await refreshNetdiskAccount()
        if (netdiskAvailable && !netdiskAccountKnown.value)
          throw new Error('115 账号读取失败')
      })(),
      (async () => {
        if (storageWebDav) sources.value = await storageWebDav.list()
      })(),
      (async () => {
        if (mountsApi) mounts.value = await mountsApi.list()
      })(),
    ])
    checked.value = {}
    error.value = results
      .flatMap(result =>
        result.status === 'rejected' ? [message(result.reason)] : []
      )
      .join('；')
    loading.value = false
  }

  async function run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action()
    } catch (cause) {
      toast.error(message(cause))
    }
  }

  async function editSmb(source?: StorageMount): Promise<void> {
    let input: StorageMountInput | null = null
    const saved = await confirmDialog({
      title: source ? `编辑「${source.name}」` : '添加 SMB 共享',
      width: 480,
      okText: '连接并保存',
      content: () =>
        h(SmbMountForm, {
          source,
          onChange: (next: StorageMountInput) => {
            input = next
          },
        }),
      onOk: async () => {
        if (!input?.path.trim() || !mountsApi) throw new Error('请填写共享路径')
        await mountsApi.save({ ...input })
      },
    })
    if (saved) await reload()
  }

  function add(kind: StorageEntry['kind']): void {
    if (kind === '115') {
      if (!netdiskAccountKnown.value) {
        void run(reload)
        return
      }
      if (netdiskAccount.value?.loggedIn) {
        void router.push('/netdisk')
        return
      }
      loginOpen.value = true
    } else if (kind === 'webdav') {
      void run(async () => {
        if (await editStorageWebDav()) await reload()
      })
    } else void run(() => editSmb())
  }

  async function check(entry: StorageEntry): Promise<void> {
    if (checking.value[entry.id]) return
    checking.value[entry.id] = true
    try {
      if (entry.kind === 'webdav') {
        const result = await storageWebDav!.listDirs(entry.source.id, '/')
        if (!result.ok) throw new Error(result.message)
      } else if (entry.kind === 'smb') await mountsApi!.check(entry.source.id)
      else {
        const account = await netdisk().account()
        setNetdiskAccount(account)
        if (!account.loggedIn) throw new Error('115 登录已失效，请重新扫码')
      }
      checked.value[entry.id] = 'ok'
      toast.success(`「${entry.name}」连接正常`)
    } catch (cause) {
      checked.value[entry.id] = 'error'
      throw cause
    } finally {
      checking.value[entry.id] = false
    }
  }

  function open(entry: StorageEntry): void {
    void run(async () => {
      if (entry.kind === '115') await router.push('/netdisk')
      else if (entry.kind === 'webdav')
        await addStorageWebDavLibrary(entry.source)
      else {
        const result = await window.api.shell.openPath(entry.source.path)
        if (!result.success) throw new Error(result.error || '无法打开共享目录')
      }
    })
  }

  async function remove(entry: StorageEntry): Promise<void> {
    if (entry.kind === 'webdav') {
      if (await removeStorageWebDav(entry.source)) await reload()
      return
    }
    const removed = await confirmDialog({
      title:
        entry.kind === '115' ? '退出 115 登录？' : `移除「${entry.name}」？`,
      content:
        entry.kind === '115'
          ? '退出后暂停使用网盘搜剧和自动追更。'
          : '只移除连接记录，不删除共享文件或媒体库。',
      okText: entry.kind === '115' ? '退出登录' : '移除',
      danger: true,
      onOk: async () => {
        if (entry.kind === '115') {
          await netdisk().logout()
          setNetdiskAccount({ loggedIn: false })
        } else await mountsApi!.remove(entry.source.id)
      },
    })
    if (removed) await reload()
  }

  function menu(entry: StorageEntry): MenuButtonItem[] {
    const items: MenuButtonItem[] = [
      {
        key: 'check',
        label: '检查连接',
        icon: 'refresh',
        disabled: checking.value[entry.id],
        onSelect: () => {
          void run(() => check(entry))
        },
      },
    ]
    if (entry.kind === 'webdav')
      items.push({
        key: 'edit',
        label: '编辑连接',
        icon: 'edit',
        onSelect: () => {
          void run(async () => {
            if (await editStorageWebDav(entry.source)) await reload()
          })
        },
      })
    if (entry.kind === 'smb')
      items.push(
        {
          key: 'edit',
          label: '编辑连接',
          icon: 'edit',
          onSelect: () => {
            void run(() => editSmb(entry.source))
          },
        },
        {
          key: 'library',
          label: '添加到媒体库',
          icon: 'plus',
          onSelect: () => {
            void run(async () => {
              await mountsApi!.check(entry.source.id)
              await addStorageMountLibrary(entry.source.path, entry.source.name)
            })
          },
        }
      )
    items.push({
      key: 'remove',
      label: entry.kind === '115' ? '退出登录' : '移除存储',
      icon: 'trash',
      onSelect: () => {
        void run(() => remove(entry))
      },
    })
    return items
  }

  onMounted(() => {
    void reload()
  })
  return {
    entries,
    loading,
    error,
    checking,
    checked,
    loginOpen,
    reload,
    add,
    open,
    menu,
    mountsAvailable: Boolean(mountsApi),
    webdavAvailable: Boolean(storageWebDav),
  }
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
