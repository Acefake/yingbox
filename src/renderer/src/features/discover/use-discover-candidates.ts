/**
 * 候选面板的状态与动作：先看前提（115 登录、PanSou、闸门），再搜 115 资源，用户点「转存」才存。
 *
 * 发给 IPC 的一律是新拼的普通对象（不传响应式对象）。转存成功后交给 discover-state 跟进入库。
 */
import { type Ref, ref } from 'vue'

import type {
  DiscoverCandidate,
  DiscoverSetup,
} from '../../../../shared/contract/discover'
import { discoverApi } from './api'
import type { DiscoverTitle } from './discover-rules'
import { clearPhase, markSaved, markSaving } from './discover-state'

/** 面板所处的阶段 */
export type CandidatesStage =
  | 'checking'
  | 'setup'
  | 'searching'
  | 'list'
  | 'empty'
  | 'error'
  | 'saved'

/** 前提缺失时的提示 */
export const SETUP_TEXT: Record<DiscoverSetup, string> = {
  login: '还没登录 115：去设置 · 网盘扫码登录后再找',
  pansou: '还没配置 PanSou：去设置 · 网盘填写地址后再找',
}

/** 候选面板的状态与动作 */
export interface DiscoverCandidatesState {
  stage: Ref<CandidatesStage>
  /** 提示 / 失败原因 / 转存结果 */
  message: Ref<string>
  candidates: Ref<DiscoverCandidate[]>
  /** 转存目标文件夹的显示名 */
  folder: Ref<string>
  /** 正在转存的候选序号 */
  saving: Ref<number | null>
  search: () => Promise<void>
  save: (index: number) => Promise<void>
}

/** 候选面板 */
export function useDiscoverCandidates(
  target: () => DiscoverTitle
): DiscoverCandidatesState {
  const stage = ref<CandidatesStage>('checking')
  const message = ref('')
  const candidates = ref<DiscoverCandidate[]>([])
  const folder = ref('')
  const saving = ref<number | null>(null)
  let searchId = ''

  function fail(text: string, setup?: DiscoverSetup): void {
    stage.value = setup ? 'setup' : 'error'
    message.value = setup ? SETUP_TEXT[setup] : text
  }

  /** 检查前提并搜索 */
  async function search(): Promise<void> {
    const title = target()
    stage.value = 'checking'
    message.value = ''
    candidates.value = []
    if (title.kind !== 'movie')
      return fail('剧集暂不支持找 115 资源，可以先在线看')
    try {
      const ready = await discoverApi().status()
      folder.value = ready.folder
      if (!ready.pansou) return fail('', 'pansou')
      if (!ready.loggedIn) return fail('', 'login')
      if (ready.paused) return fail(ready.paused)
      stage.value = 'searching'
      const result = await discoverApi().find({
        kind: 'movie',
        title: title.title,
        originalTitle: title.originalTitle,
        year: title.year,
      })
      if (!result.ok) return fail(result.error, result.setup)
      searchId = result.searchId
      candidates.value = result.candidates
      stage.value = result.candidates.length ? 'list' : 'empty'
      message.value = result.note ?? ''
    } catch (error) {
      fail(`搜索失败：${(error as Error).message}`)
    }
  }

  /** 转存第 index 个候选（用户点了「转存」才会调） */
  async function save(index: number): Promise<void> {
    if (saving.value !== null) return
    const title = target()
    saving.value = index
    markSaving(title)
    try {
      const result = await discoverApi().save(searchId, index)
      if (!result.ok) {
        clearPhase(title)
        return fail(result.error, result.setup)
      }
      folder.value = result.folder
      stage.value = 'saved'
      message.value = `「${result.fileName}」已转存到 ${result.folder}，约 10 分钟后通知媒体库扫描`
      markSaved(title)
    } catch (error) {
      clearPhase(title)
      fail(`转存失败：${(error as Error).message}`)
    } finally {
      saving.value = null
    }
  }

  return { stage, message, candidates, folder, saving, search, save }
}
