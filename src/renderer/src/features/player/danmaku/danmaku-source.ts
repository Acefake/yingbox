/**
 * 为当前条目找弹幕库：先看绑定（条目 → 整部剧），本地文件按 hash 识别，
 * 再按片名 + 集数搜索；找到的结果按条目记住（自动匹配 30 天，手动绑定永久）。
 */
import { toLocalUrl } from '@/utils/local-url'

import type {
  DanmakuAnime,
  DanmakuComment,
  DanmakuReply,
} from '../../../../../shared/contract/danmaku'
import {
  type DanmakuBinding,
  type DanmakuTarget,
  type PickedEpisode,
  entryKey,
  pickSearchMatch,
  searchParams,
  seriesKey,
} from './danmaku-rules'
import { findBinding, saveBinding } from './danmaku-store'

/** 找弹幕库的结果 */
export interface ResolvedSource {
  binding: DanmakuBinding | null
  /** 自动匹配且不是精确关联：提示用户可能不准 */
  uncertain: boolean
  /** 失败原因；没找到时为空串 */
  error: string
  notConfigured: boolean
}

const api = (): Window['api']['danmaku'] => window.api.danmaku

/** 把一次失败的接口返回转成结果 */
const failed = (reply: DanmakuReply<unknown>): ResolvedSource => ({
  binding: null,
  uncertain: false,
  error: reply.error || '弹幕服务出错',
  notConfigured: reply.notConfigured === true,
})

/** 自动匹配结果写成绑定并保存 */
function remember(
  key: string,
  picked: PickedEpisode & { shift?: number },
  manual: boolean
): DanmakuBinding {
  const binding: DanmakuBinding = {
    key,
    episodeId: picked.episodeId,
    animeId: picked.animeId,
    animeTitle: picked.animeTitle,
    episodeTitle: picked.episodeTitle,
    shift: picked.shift ?? 0,
    manual,
    savedAt: Date.now(),
  }
  saveBinding(binding)
  return binding
}

/** 为条目找弹幕库 */
export async function resolveSource(
  target: DanmakuTarget
): Promise<ResolvedSource> {
  const key = entryKey(target)
  const cached = findBinding(key)
  if (cached)
    return {
      binding: cached,
      uncertain: false,
      error: '',
      notConfigured: false,
    }

  // 本地文件：hash + 文件名识别；精确关联直接用，模糊结果先用第一项
  if (target.filePath) {
    const reply = await api().match(toLocalUrl(target.filePath))
    if (!reply.success) {
      if (reply.notConfigured) return failed(reply)
    } else if (reply.data?.matches.length) {
      const first = reply.data.matches[0]
      return {
        binding: remember(key, first, false),
        uncertain: !reply.data.isMatched,
        error: '',
        notConfigured: false,
      }
    }
  }

  // 按片名 + 集数搜索；整部剧手动选过作品时只在该作品里找
  const series = findBinding(seriesKey(target.title))
  const params = searchParams(target, series?.animeTitle)
  if (!params)
    return { binding: null, uncertain: false, error: '', notConfigured: false }
  const reply = await api().search(params.anime, params.episode)
  if (!reply.success) return failed(reply)
  const picked = pickSearchMatch(
    reply.data ?? [],
    params.anime,
    series?.animeId || undefined
  )
  if (!picked)
    return { binding: null, uncertain: false, error: '', notConfigured: false }
  return {
    binding: remember(key, picked, false),
    uncertain: !series,
    error: '',
    notConfigured: false,
  }
}

/** 手动搜索作品 */
export async function searchAnimes(
  keyword: string
): Promise<DanmakuReply<DanmakuAnime[]>> {
  return api().search(keyword.trim())
}

/** 手动绑定：记到条目上；在线条目同时记住整部剧选的作品，后面几集按它找 */
export function bindManually(
  target: DanmakuTarget,
  picked: PickedEpisode
): DanmakuBinding {
  const binding = remember(entryKey(target), picked, true)
  if (!target.filePath) {
    const series = seriesKey(target.title)
    if (series)
      remember(series, { ...picked, episodeId: 0, episodeTitle: '' }, true)
  }
  return binding
}

/** 取弹幕（主进程磁盘缓存 7 天） */
export async function fetchComments(
  episodeId: number
): Promise<DanmakuReply<DanmakuComment[]>> {
  return api().comments(episodeId)
}
