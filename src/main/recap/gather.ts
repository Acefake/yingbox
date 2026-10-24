/**
 * 一次请求的素材汇总：当前集与之前几集各自定位到的素材，以及由它们算出的前情提要缓存键。
 * 开播探测（probe）与生成前准备（prepare）都走这里，保证两次得到的缓存键一致
 * （「第二次打开直接展示」依赖这一点）。不依赖 Electron：文件与网络由调用方经 SourceDeps 注入。
 */
import { RECAP_MAX_PREVIOUS, recapKey } from '../../shared/recap/budget'
import { previousEpisodes } from '../../shared/recap/episodes'
import type { RecapEpisodeRef } from '../../shared/recap/types'
import {
  type LocatedMaterial,
  type SourceDeps,
  findTvshowTmdbId,
  listEpisodes,
  locateMaterial,
  once,
  standaloneFile,
} from './sources'

/** 一次请求定位到的素材 */
export interface Gathered {
  videoPath: string
  show: string
  episode: RecapEpisodeRef | null
  current: LocatedMaterial | null
  previous: LocatedMaterial[]
}

/**
 * 定位当前集与之前几集的素材：看文件名、修改时间，读同目录的 NFO 与 tvshow.nfo；
 * 不读字幕、不联网、不调模型。withCurrent 时连本集素材一起定位（本集只用台词，不联网）。
 */
export async function gatherMaterial(
  videoPath: string,
  deps: SourceDeps,
  input: { isPrivate: boolean; withCurrent: boolean }
): Promise<Gathered> {
  const listing = await listEpisodes(videoPath, deps)
  const current = listing.current
  const options = {
    allowNetwork: !input.isPrivate,
    tmdbId: once(() => findTvshowTmdbId(videoPath, deps)),
  }
  const candidates = current
    ? previousEpisodes(current, listing.siblings, RECAP_MAX_PREVIOUS)
    : []
  const previous = (
    await Promise.all(
      candidates.map(file => locateMaterial(file, listing.names, deps, options))
    )
  ).filter((item): item is LocatedMaterial => item !== null)
  const currentMaterial = input.withCurrent
    ? await locateMaterial(
        current ?? standaloneFile(videoPath),
        listing.names,
        deps,
        { ...options, allowNetwork: false }
      )
    : null
  return {
    videoPath,
    show: current?.show ?? standaloneFile(videoPath).show,
    episode: current
      ? {
          label: current.label,
          episode: current.episode,
          ...(current.season === undefined ? {} : { season: current.season }),
        }
      : null,
    current: currentMaterial,
    previous,
  }
}

/** 前情提要的缓存键：只看当前视频和之前各集素材的键；认不出集数时为空串 */
export function gatheredCacheKey(found: Gathered): string {
  return found.episode
    ? recapKey(
        found.videoPath,
        found.previous.map(item => item.key)
      )
    : ''
}
