/**
 * 待确认 / 手动匹配：读取某条目的本地文件与候选，提供采用候选、手动搜索、锁定 / 解锁、
 * 重新获取元数据等操作。待确认队列和详情页的“修正匹配”共用。
 */
import { type Ref, ref, shallowRef, watch } from 'vue'

import type {
  ApplyMatchRequest,
  ApplyMatchResult,
  LibraryBridge,
  LibraryItemNode,
  MatchCandidateInfo,
  MatchCandidatesResult,
} from '../../../../../shared/library/ipc'
import { errorText } from '../api/bridge'

/** 手动匹配输入解析后的三种形态，对应 applyMatch 的参数。 */
export type ManualMatch =
  | { tmdbId: string }
  | { imdbId: string }
  | { query: { title: string; year?: number } }

const TMDB_URL_RE = /themoviedb\.org\/(?:movie|tv)\/(\d+)/i
const TMDB_ID_RE = /^(?:tmdb[:：\s]*)?(\d{1,9})$/i
const IMDB_RE = /(tt\d{6,9})/i
const TITLE_YEAR_RE = /^(.*?)[\s.(（[]*((?:19|20)\d{2})[)）\]]?$/

/**
 * 解析用户在搜索框里输入的内容：
 * - 纯数字、“tmdb 123”、TMDB 链接 → tmdbId；
 * - tt 开头的 IMDb 编号或链接 → imdbId；
 * - 其余当片名，末尾的年份（“星际穿越 2014”“Heat (1995)”）单独取出。
 */
export function parseManualMatch(input: string): ManualMatch | null {
  const text = input.trim()
  if (!text) return null
  const tmdbUrl = TMDB_URL_RE.exec(text)
  if (tmdbUrl) return { tmdbId: tmdbUrl[1] }
  const tmdbId = TMDB_ID_RE.exec(text)
  if (tmdbId) return { tmdbId: tmdbId[1] }
  const imdb = IMDB_RE.exec(text)
  if (imdb && (/imdb\.com/i.test(text) || /^tt\d+$/i.test(text))) {
    return { imdbId: imdb[1].toLowerCase() }
  }
  const titleYear = TITLE_YEAR_RE.exec(text)
  if (titleYear && titleYear[1].trim()) {
    return {
      query: { title: titleYear[1].trim(), year: Number(titleYear[2]) },
    }
  }
  return { query: { title: text } }
}

/** 本地文件名（不含目录），给“左边本地、右边候选”的对照用。 */
export function localFileNames(node: LibraryItemNode | null): string[] {
  if (!node) return []
  const names: string[] = []
  const visit = (n: LibraryItemNode): void => {
    for (const file of n.files) {
      if (file.kind === 'video') names.push(file.path.split(/[\\/]/).pop()!)
    }
    n.children.forEach(visit)
  }
  visit(node)
  return names
}

/** 用到的 bridge 方法（测试里可以只给假的这几个）。 */
export type ReviewBridge = Pick<
  LibraryBridge,
  | 'getItem'
  | 'getMatchCandidates'
  | 'applyMatch'
  | 'lockMatch'
  | 'unlockMatch'
  | 'refreshMetadata'
>

/** 一次操作的结果，界面据此提示并决定是否跳到下一条。 */
export type ReviewOutcome =
  | { kind: 'matched' }
  | { kind: 'candidates'; count: number }
  | { kind: 'unmatched' }
  | { kind: 'error'; message: string }

/** useMatchReview 的返回值。 */
export interface MatchReview {
  node: Ref<LibraryItemNode | null>
  candidates: Ref<MatchCandidatesResult | null>
  /** 手动搜索返回的候选；非空时替代保存的候选显示。 */
  searchResults: Ref<MatchCandidateInfo[] | null>
  loading: Ref<boolean>
  /** 正在执行的操作（按钮转圈用）；null 表示空闲。 */
  busy: Ref<string | null>
  error: Ref<string | null>
  reload: () => Promise<void>
  adopt: (candidate: MatchCandidateInfo) => Promise<ReviewOutcome>
  search: (input: string) => Promise<ReviewOutcome>
  setLocked: (locked: boolean) => Promise<ReviewOutcome>
  refreshMetadata: () => Promise<ReviewOutcome>
}

/** 某条目的匹配审阅状态。itemId 变化时自动重新读取。 */
export function useMatchReview(
  itemId: Ref<number | null>,
  bridge: ReviewBridge | null
): MatchReview {
  const node = shallowRef<LibraryItemNode | null>(null)
  const candidates = shallowRef<MatchCandidatesResult | null>(null)
  const searchResults = shallowRef<MatchCandidateInfo[] | null>(null)
  const loading = ref(false)
  const busy = ref<string | null>(null)
  const error = ref<string | null>(null)
  let token = 0

  async function reload(): Promise<void> {
    const id = itemId.value
    const mine = ++token
    searchResults.value = null
    error.value = null
    if (id === null || !bridge) {
      node.value = null
      candidates.value = null
      return
    }
    loading.value = true
    try {
      const [item, match] = await Promise.all([
        bridge.getItem(id),
        bridge.getMatchCandidates(id),
      ])
      if (mine !== token) return
      node.value = item
      candidates.value = match
    } catch (e) {
      if (mine === token) error.value = errorText(e)
    } finally {
      if (mine === token) loading.value = false
    }
  }

  watch(itemId, () => void reload(), { immediate: true })

  async function act(
    name: string,
    task: (id: number) => Promise<ReviewOutcome>
  ): Promise<ReviewOutcome> {
    const id = itemId.value
    if (id === null || !bridge) {
      return { kind: 'error', message: '媒体库不可用' }
    }
    busy.value = name
    error.value = null
    try {
      return await task(id)
    } catch (e) {
      const message = errorText(e)
      error.value = message
      return { kind: 'error', message }
    } finally {
      busy.value = null
    }
  }

  function outcomeOf(result: ApplyMatchResult): ReviewOutcome {
    if (result.status === 'matched') return { kind: 'matched' }
    if (result.candidates.length) {
      searchResults.value = result.candidates
      return { kind: 'candidates', count: result.candidates.length }
    }
    searchResults.value = []
    return { kind: 'unmatched' }
  }

  async function apply(
    request: Omit<ApplyMatchRequest, 'itemId'>,
    id: number
  ): Promise<ReviewOutcome> {
    const outcome = outcomeOf(
      await bridge!.applyMatch({ ...request, itemId: id })
    )
    if (outcome.kind === 'matched') await reload()
    return outcome
  }

  return {
    node,
    candidates,
    searchResults,
    loading,
    busy,
    error,
    reload,
    adopt: candidate =>
      act(`adopt:${candidate.id}`, id =>
        apply({ tmdbId: candidate.id, lock: true }, id)
      ),
    search: input =>
      act('search', id => {
        const parsed = parseManualMatch(input)
        if (!parsed) return Promise.resolve({ kind: 'unmatched' })
        return apply({ ...parsed, lock: true }, id)
      }),
    setLocked: locked =>
      act(locked ? 'lock' : 'unlock', async id => {
        await (locked ? bridge!.lockMatch(id) : bridge!.unlockMatch(id))
        await reload()
        return { kind: 'matched' }
      }),
    refreshMetadata: () =>
      act('refresh', async id => {
        await bridge!.refreshMetadata({ itemIds: [id] })
        return { kind: 'matched' }
      }),
  }
}
