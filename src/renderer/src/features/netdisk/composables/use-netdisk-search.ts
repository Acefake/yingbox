/**
 * 网盘搜索的状态：关键词、结果（115 分享 + 磁力）、各来源的失败说明、加载与错误。
 * - 新搜索一开始就清掉上一个词的结果并进入加载态（旧列表不会挂在新词的 Hero 下面）；
 * - 只认最后一次搜索的结果（请求序号），晚到的旧响应丢弃；reset() 清空时也让在途请求作废；
 * - IPC 被拒绝（主进程异常、窗口关闭）时也复位加载态并给出错误。
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
  /** 回到还没搜的状态：清空结果、错误与加载态，在途请求作废（清空搜索框时用） */
  reset(): void
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

  /** 清掉结果与错误（不动关键词） */
  function clear(): void {
    items.value = []
    magnets.value = []
    notes.value = []
    error.value = ''
    searched.value = false
  }

  function reset(): void {
    seq++
    clear()
    loading.value = false
  }

  async function search(): Promise<void> {
    const kw = keyword.value.trim()
    if (!kw) return
    const id = ++seq
    clear()
    loading.value = true
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

  return {
    keyword,
    items,
    magnets,
    notes,
    loading,
    searched,
    error,
    search,
    reset,
  }
}
