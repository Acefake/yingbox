/**
 * 115 文件夹选择的状态：逐层打开，请求序号保证只认最后一次打开的目录；
 * 加载中不能「存到这里」；从当前已选目录打开，打不开（被删、无权限）时退回根目录。
 */
import { type ComputedRef, type Ref, computed, ref } from 'vue'

import type { Api } from '../../../../../shared/contract'
import type {
  Pan115Dir,
  Pan115DirListing,
} from '../../../../../shared/contract/pan115'

import { errorText } from '../utils/netdisk-rules'

/** 选择器状态与动作 */
export interface FolderPicker {
  listing: Ref<Pan115DirListing | null>
  loading: Ref<boolean>
  error: Ref<string>
  /** 可以「存到这里」：已加载、没出错、没在加载 */
  canPick: ComputedRef<boolean>
  open(cid: string): Promise<void>
  /** 首次打开：先试 cid，失败再回根目录 */
  start(cid: string): Promise<void>
  /** 当前目录 */
  here(): Pan115Dir | null
}

export function useFolderPicker(
  api: () => Pick<Api['pan115'], 'dirs'>
): FolderPicker {
  const listing = ref<Pan115DirListing | null>(null)
  const loading = ref(false)
  const error = ref('')
  let seq = 0

  async function open(cid: string): Promise<void> {
    const id = ++seq
    loading.value = true
    error.value = ''
    let result: Awaited<ReturnType<Api['pan115']['dirs']>>
    try {
      result = await api().dirs(cid)
    } catch (e) {
      result = { ok: false, error: `读取文件夹失败：${errorText(e)}` }
    }
    if (id !== seq) return
    loading.value = false
    if (result.ok) {
      const { cid: at, path, dirs, truncated } = result
      listing.value = { cid: at, path, dirs, truncated }
    } else error.value = result.error
  }

  async function start(cid: string): Promise<void> {
    await open(cid || '0')
    if (error.value && cid && cid !== '0') await open('0')
  }

  function here(): Pan115Dir | null {
    const current = listing.value
    if (!current) return null
    const last = current.path[current.path.length - 1]
    return { cid: current.cid, name: last?.name ?? '' }
  }

  const canPick = computed(
    () => !loading.value && !error.value && listing.value !== null
  )

  return { listing, loading, error, canPick, open, start, here }
}
