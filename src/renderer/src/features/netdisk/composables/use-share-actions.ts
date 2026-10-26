/**
 * 搜索结果上的动作：复制链接、查看文件（页面里单独的预览区）、转存。
 * - 进行中重复点击不重发；IPC 抛错时复位状态并提示；
 * - 预览换了一条时，上一条晚到的响应作废；
 * - 剪贴板被拒绝时提示「复制失败」，不留未处理的 rejection。
 */
import { type Ref, reactive, ref } from 'vue'

import type { Api } from '../../../../../shared/contract'
import type {
  MagnetItem,
  NetdiskItem,
  ShareSnap,
} from '../../../../../shared/contract/pan115'

import { errorText } from '../utils/netdisk-rules'

/** 轻提示 */
export interface Notifier {
  success(message: string): void
  error(message: string): void
}

/** 依赖（组件里传 netdisk / toast / navigator.clipboard） */
export interface ShareActionDeps {
  api: () => Pick<Api['pan115'], 'snap' | 'receive'>
  notify: Notifier
  clipboard: () => Pick<Clipboard, 'writeText'>
}

/** 复制到剪贴板的文字：链接里没带提取码时补在后面 */
export function shareText(item: NetdiskItem): string {
  const { url, receiveCode } = item
  return receiveCode && !url.includes('password=')
    ? `${url} 提取码：${receiveCode}`
    : url
}

/** 结果动作的状态与方法 */
export interface ShareActions {
  preview: {
    item: Ref<NetdiskItem | null>
    snap: Ref<ShareSnap | null>
    loading: Ref<boolean>
  }
  openPreview(item: NetdiskItem): Promise<void>
  closePreview(): void
  isSaving(url: string): boolean
  isSaved(url: string): boolean
  save(item: NetdiskItem): Promise<void>
  /** 复制 115 分享（补提取码）或磁力 / 电驴链接 */
  copy(item: NetdiskItem | MagnetItem): Promise<void>
}

export function useShareActions(deps: ShareActionDeps): ShareActions {
  const item = ref<NetdiskItem | null>(null)
  const snap = ref<ShareSnap | null>(null)
  const loading = ref(false)
  const saving = reactive(new Set<string>())
  const saved = reactive(new Set<string>())
  let seq = 0

  async function openPreview(target: NetdiskItem): Promise<void> {
    if (loading.value && item.value?.url === target.url) return
    const id = ++seq
    item.value = target
    snap.value = null
    loading.value = true
    let result: Awaited<ReturnType<Api['pan115']['snap']>>
    try {
      result = await deps.api().snap(target.url, target.receiveCode)
    } catch (e) {
      result = { ok: false, error: `读取分享失败：${errorText(e)}` }
    }
    if (id !== seq) return
    loading.value = false
    if (result.ok) snap.value = result
    else {
      item.value = null
      deps.notify.error(result.error)
    }
  }

  function closePreview(): void {
    seq++
    item.value = null
    snap.value = null
    loading.value = false
  }

  async function save(target: NetdiskItem): Promise<void> {
    const { url } = target
    if (saving.has(url) || saved.has(url)) return
    saving.add(url)
    try {
      const result = await deps.api().receive(url, target.receiveCode)
      if (result.ok) {
        saved.add(url)
        deps.notify.success('已转存到 115')
      } else deps.notify.error(result.error)
    } catch (e) {
      deps.notify.error(`转存失败：${errorText(e)}`)
    } finally {
      saving.delete(url)
    }
  }

  async function copy(target: NetdiskItem | MagnetItem): Promise<void> {
    try {
      await deps
        .clipboard()
        .writeText('link' in target ? target.link : shareText(target))
      deps.notify.success('已复制链接')
    } catch {
      deps.notify.error('复制失败，请手动复制链接')
    }
  }

  return {
    preview: { item, snap, loading },
    openPreview,
    closePreview,
    isSaving: url => saving.has(url),
    isSaved: url => saved.has(url),
    save,
    copy,
  }
}
