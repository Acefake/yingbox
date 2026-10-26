/**
 * 网盘搜索的状态：关键词、结果（115 分享 + 磁力）、各来源的失败说明、加载与错误。只认最后一次搜索的结果；
 * IPC 被拒绝（主进程异常、窗口关闭）时也复位加载态并给出错误。
 */
import { type Ref, ref } from 'vue'

import type { Api } from '../../../../../shared/contract'
import type {
  MagnetItem,
  NetdiskItem,
} from '../../../../../shared/contract/pan115'

import { errorText } from '../utils/netdisk-rules'

/** 搜索状态与动作 */
export interface NetdiskSearch {
  keyword: Ref<string>
  items: Ref<NetdiskItem[]>
  magnets: Ref<MagnetItem[]>
  /** 没拿到结果的来源（另一个来源照常出结果） */
  notes: Ref<string[]>
  loading: Ref<boolean>
  /** 搜过至少一次（区分「还没搜」与「没结果」） */
  searched: Ref<boolean>
  error: Ref<string>
  search(): Promise<void>
}

/** @param api 取 pan115 域（只用 search） */
export function useNetdiskSearch(
  api: () => Pick<Api['pan115'], 'search'>
): NetdiskSearch {
  const keyword = ref('')
  const items = ref<NetdiskItem[]>([])
  const magnets = ref<MagnetItem[]>([])
  const notes = ref<string[]>([])
  const loading = ref(false)
  const searched = ref(false)
  const error = ref('')
  let seq = 0

  async function search(): Promise<void> {
    const kw = keyword.value.trim()
    if (!kw) return
    const id = ++seq
    loading.value = true
    error.value = ''
    let result: Awaited<ReturnType<Api['pan115']['search']>>
    try {
      result = await api().search(kw)
    } catch (e) {
      result = { ok: false, error: `搜索请求失败：${errorText(e)}` }
    }
    if (id !== seq) return
    loading.value = false
    searched.value = true
    items.value = result.ok ? result.items : []
    magnets.value = result.ok ? result.magnets : []
    notes.value = result.ok ? result.notes : []
    if (!result.ok) error.value = result.error
  }

  return { keyword, items, magnets, notes, loading, searched, error, search }
}
