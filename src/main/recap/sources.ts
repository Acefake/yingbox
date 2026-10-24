/**
 * 前情提要的素材定位：同目录里认出各集，再给每集找素材，优先级
 * AI 字幕 → 外挂中文 / 英文 srt → 同名 NFO 的 <plot>（媒体库刮削写入的 TMDB 分集简介）→ 联网查 TMDB 分集简介。
 *
 * 定位（{@link locateMaterial}）看文件名和修改时间，并读同目录的 NFO（确认有 <plot>）与 tvshow.nfo
 * （找 TMDB id），得到缓存键；字幕与联网查简介放在 read() 里，所以开播探测不读字幕、不联网。
 * 不依赖 Electron：文件读写与 TMDB 请求由 index.ts 注入。
 */
import { dirname, join } from 'node:path'
import { parseSrt } from '../../shared/ai-subtitles/srt'
import type {
  AiSubtitleCue,
  AiSubtitleMode,
} from '../../shared/ai-subtitles/types'
import { type MaterialIdentity, episodeKey } from '../../shared/recap/budget'
import {
  type EpisodeFile,
  episodeOf,
  nfoPlot,
  pickSidecarSrt,
  stemOf,
  tvshowTmdbId,
} from '../../shared/recap/episodes'
import { parseMediaPath } from '../../shared/library/parser'

/** 素材定位依赖 */
export interface SourceDeps {
  readdir: (dir: string) => Promise<string[]>
  /** 文件信息；不存在时返回 null */
  stat: (path: string) => Promise<{ mtimeMs: number; size: number } | null>
  /** 读文本（字幕按编码探测解码）；失败抛错 */
  readText: (path: string) => Promise<string>
  /** 这个视频已生成的 AI 字幕 */
  aiSubtitle: (
    videoPath: string
  ) => Promise<{ path: string; mode: AiSubtitleMode } | null>
  /** 联网查 TMDB 分集简介（未配置令牌或失败时返回 null） */
  tmdbOverview?: (
    tvId: string,
    season: number,
    episode: number
  ) => Promise<string | null>
}

/** 读出来的一集素材 */
export type EpisodeMaterial =
  | { kind: 'subtitle'; cues: AiSubtitleCue[]; bilingual: boolean }
  | { kind: 'overview'; text: string }

/** 定位到的一集素材（还没读内容） */
export interface LocatedMaterial {
  file: EpisodeFile
  identity: MaterialIdentity
  /** 整集摘要的缓存键 */
  key: string
  read: () => Promise<EpisodeMaterial | null>
}

/** 同目录的视频文件名 */
export interface EpisodeListing {
  current: EpisodeFile | null
  siblings: EpisodeFile[]
  /** 目录里的全部文件名（挑字幕 / NFO 用） */
  names: string[]
}

/** 认出当前视频与同目录各集（当前视频不是剧集时 current 为 null、siblings 为空） */
export async function listEpisodes(
  videoPath: string,
  deps: Pick<SourceDeps, 'readdir'>
): Promise<EpisodeListing> {
  const dir = dirname(videoPath)
  const names = await deps.readdir(dir).catch(() => [] as string[])
  const current = episodeOf(videoPath)
  if (!current) return { current: null, siblings: [], names }
  const siblings: EpisodeFile[] = []
  for (const name of names) {
    const file = episodeOf(join(dir, name))
    if (file) siblings.push(file)
  }
  return { current, siblings, names }
}

/** 不是剧集的视频（电影等）当作单独一「集」，问剧情仍可用它自己的台词 */
export function standaloneFile(videoPath: string): EpisodeFile {
  const parsed = parseMediaPath(videoPath.replace(/\\/g, '/'))
  return {
    path: videoPath,
    show: parsed.title || stemOf(videoPath),
    episode: 0,
    label: '本片',
  }
}

/** 定位选项 */
export interface LocateOptions {
  /** 允许联网查 TMDB（私密内容不联网） */
  allowNetwork: boolean
  /** 剧集的 TMDB id（懒加载，只在本地没有素材时才查） */
  tmdbId: () => Promise<string | null>
}

const located = (
  file: EpisodeFile,
  identity: MaterialIdentity,
  read: LocatedMaterial['read']
): LocatedMaterial => ({ file, identity, key: episodeKey(identity), read })

/** 给一集找素材；什么都没有时返回 null */
export async function locateMaterial(
  file: EpisodeFile,
  names: readonly string[],
  deps: SourceDeps,
  options: LocateOptions
): Promise<LocatedMaterial | null> {
  const dir = dirname(file.path)
  const readSrt = (path: string, bilingual: boolean) => async () => {
    const cues = parseSrt(await deps.readText(path))
    return cues.length ? { kind: 'subtitle' as const, cues, bilingual } : null
  }

  const ai = await deps.aiSubtitle(file.path).catch(() => null)
  const aiInfo = ai ? await deps.stat(ai.path) : null
  if (ai && aiInfo)
    return located(
      file,
      {
        videoPath: file.path,
        kind: 'subtitle',
        sourcePath: ai.path,
        ...aiInfo,
      },
      readSrt(ai.path, ai.mode === 'bilingual')
    )

  const sidecar = pickSidecarSrt(file.path, names)
  const sidecarPath = sidecar ? join(dir, sidecar) : ''
  const sidecarInfo = sidecarPath ? await deps.stat(sidecarPath) : null
  if (sidecarInfo)
    return located(
      file,
      {
        videoPath: file.path,
        kind: 'subtitle',
        sourcePath: sidecarPath,
        ...sidecarInfo,
      },
      readSrt(sidecarPath, false)
    )

  const stem = stemOf(file.path).toLowerCase()
  const nfoName = names.find(name => name.toLowerCase() === `${stem}.nfo`)
  if (nfoName) {
    const nfoPath = join(dir, nfoName)
    const plot = nfoPlot(await deps.readText(nfoPath).catch(() => ''))
    const info = plot ? await deps.stat(nfoPath) : null
    if (plot && info)
      return located(
        file,
        {
          videoPath: file.path,
          kind: 'overview',
          sourcePath: nfoPath,
          ...info,
        },
        async () => ({ kind: 'overview', text: plot })
      )
  }

  if (!options.allowNetwork || !deps.tmdbOverview) return null
  const tvId = await options.tmdbId()
  if (!tvId) return null
  const season = file.season ?? 1
  const fetchOverview = deps.tmdbOverview
  return located(
    file,
    {
      videoPath: file.path,
      kind: 'overview',
      sourcePath: `tmdb:${tvId}:${season}:${file.episode}`,
    },
    async () => {
      const text = await fetchOverview(tvId, season, file.episode).catch(
        () => null
      )
      return text ? { kind: 'overview', text } : null
    }
  )
}

/** 找剧集的 TMDB id：视频目录、上一级、上两级里的 tvshow.nfo */
export async function findTvshowTmdbId(
  videoPath: string,
  deps: Pick<SourceDeps, 'readText'>
): Promise<string | null> {
  let dir = dirname(videoPath)
  for (let depth = 0; depth < 3; depth += 1) {
    const text = await deps.readText(join(dir, 'tvshow.nfo')).catch(() => null)
    const id = text ? tvshowTmdbId(text) : null
    if (id) return id
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** 懒加载且只查一次 */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let value: Promise<T> | null = null
  return () => (value ??= load())
}
