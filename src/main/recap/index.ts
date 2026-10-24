/**
 * 主进程前情提要 / 问剧情模块入口：组装素材定位（sources）、摘要（summarize）与缓存（cache），注册 recap 域 IPC。
 *
 * - 只处理本地文件（local:// 地址）；在线播放不支持。
 * - 摘要经 aiService().chat 发出，私密内容带 private（按设置只用本地模型），缓存只放内存、不联网查 TMDB。
 * - 最终的前情提要 / 回答由渲染层流式生成（ai.chat），这里只准备上下文并缓存结果。
 */
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { RECAP_MAX_PREVIOUS, recapKey } from '../../shared/recap/budget'
import { previousEpisodes } from '../../shared/recap/episodes'
import type {
  RecapContext,
  RecapEpisodeRef,
  RecapProbe,
} from '../../shared/recap/types'
import { recap } from '../../shared/contract/recap'
import { aiService } from '../ai'
import { findAiSubtitle } from '../ai-subtitles'
import { atomicWrite } from '../file-operations'
import { fetchHttp, readLimited } from '../http-client'
import { localUrlToFilePath } from '../local-media'
import { implement } from '../rpc'
import { settingsStore } from '../settings'
import { decodeSubtitleText } from '../subtitle'
import { TMDB_SECRET, effectiveTmdbToken } from '../tmdb'
import { createRecapCache } from './cache'
import { type Summarizer, createSummarizer } from './summarize'
import {
  type LocatedMaterial,
  type SourceDeps,
  findTvshowTmdbId,
  listEpisodes,
  locateMaterial,
  once,
  standaloneFile,
} from './sources'

const TMDB_API = 'https://api.themoviedb.org/3'

/** TMDB 分集简介：先中文，没有再英文 */
async function tmdbOverview(
  tvId: string,
  season: number,
  episode: number
): Promise<string | null> {
  const token = effectiveTmdbToken(settingsStore().getSecret(TMDB_SECRET))
  if (!token) return null
  const bearer = token.startsWith('eyJ')
  for (const language of ['zh-CN', 'en-US']) {
    const query = new URLSearchParams({ language })
    if (!bearer) query.set('api_key', token)
    const response = await fetchHttp(
      `${TMDB_API}/tv/${tvId}/season/${season}/episode/${episode}?${query}`,
      { headers: bearer ? { Authorization: `Bearer ${token}` } : {} },
      15_000
    )
    const body = JSON.parse(
      (await readLimited(response, 1024 * 1024)).toString('utf8')
    ) as { overview?: unknown }
    if (typeof body.overview === 'string' && body.overview.trim())
      return body.overview.trim()
  }
  return null
}

const sourceDeps: SourceDeps = {
  readdir: dir => fs.readdir(dir),
  stat: path =>
    fs.stat(path).then(
      info =>
        info.isFile() && info.size > 0
          ? { mtimeMs: info.mtimeMs, size: info.size }
          : null,
      () => null
    ),
  readText: async path => decodeSubtitleText(await fs.readFile(path)),
  aiSubtitle: findAiSubtitle,
  tmdbOverview,
}

/** 一次请求定位到的素材 */
interface Gathered {
  videoPath: string
  show: string
  episode: RecapEpisodeRef | null
  current: LocatedMaterial | null
  previous: LocatedMaterial[]
}

const refOf = (item: LocatedMaterial): RecapEpisodeRef => ({
  label: item.file.label,
  episode: item.file.episode,
  ...(item.file.season === undefined ? {} : { season: item.file.season }),
})

/** 定位当前集与之前几集的素材（不读内容、不调模型）；withCurrent 时连本集素材一起定位 */
async function gather(
  localUrl: string,
  isPrivate: boolean,
  withCurrent: boolean
): Promise<Gathered | null> {
  const videoPath = localUrlToFilePath(localUrl)
  if (!videoPath) return null
  const listing = await listEpisodes(videoPath, sourceDeps)
  const current = listing.current
  const options = {
    allowNetwork: !isPrivate,
    tmdbId: once(() => findTvshowTmdbId(videoPath, sourceDeps)),
  }
  const candidates = current
    ? previousEpisodes(current, listing.siblings, RECAP_MAX_PREVIOUS)
    : []
  const previous = (
    await Promise.all(
      candidates.map(file =>
        locateMaterial(file, listing.names, sourceDeps, options)
      )
    )
  ).filter((item): item is LocatedMaterial => item !== null)
  // 本集只用台词（分集简介会剧透），所以本集不联网
  const currentMaterial = withCurrent
    ? await locateMaterial(
        current ?? standaloneFile(videoPath),
        listing.names,
        sourceDeps,
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

/** 注册 recap 域（registerAi、registerAiSubtitles 之后调用一次） */
export function registerRecap(): void {
  const file = (): string =>
    join(app.getPath('userData'), 'recap', 'cache.json')
  const cache = createRecapCache({
    read: () => fs.readFile(file(), 'utf8').catch(() => null),
    write: async text => {
      await fs.mkdir(join(app.getPath('userData'), 'recap'), {
        recursive: true,
      })
      await atomicWrite(file(), text)
    },
  })
  const summarizer: Summarizer = createSummarizer({
    cache,
    chat: async (messages, options) =>
      (
        await aiService().chat({
          messages,
          maxTokens: options.maxTokens,
          private: options.private,
          temperature: 0.3,
          timeoutMs: 180_000,
        })
      ).content,
    warn: message => console.warn('[recap]', message),
  })

  implement(recap, {
    probe: async (_, localUrl, options): Promise<RecapProbe> => {
      const found = await gather(localUrl, options.private === true, false)
      if (!found?.episode)
        return {
          show: found?.show ?? '',
          episode: null,
          previous: [],
          cacheKey: '',
          cached: null,
        }
      const cacheKey = recapKey(
        found.videoPath,
        found.previous.map(item => item.key)
      )
      return {
        show: found.show,
        episode: found.episode,
        previous: found.previous.map(refOf),
        cacheKey,
        cached: found.previous.length
          ? ((await cache.get(cacheKey)) ?? null)
          : null,
      }
    },

    prepare: async (_, localUrl, options): Promise<RecapContext> => {
      const isPrivate = options.private === true
      const qa = options.purpose === 'qa'
      const found = await gather(localUrl, isPrivate, qa)
      if (!found) throw new Error('前情提要只支持本地视频文件')
      const call = { private: isPrivate }
      const previous = (
        await Promise.all(
          found.previous.map(item => summarizer.episode(found.show, item, call))
        )
      ).filter(item => item !== null)
      const context: RecapContext = {
        show: found.show,
        episode: found.episode,
        previous,
        cacheKey: found.episode
          ? recapKey(
              found.videoPath,
              found.previous.map(item => item.key)
            )
          : '',
      }
      if (qa)
        context.current = await summarizer.current(
          found.show,
          found.current,
          options.seconds ?? 0,
          call
        )
      return context
    },

    save: async (_, options) => {
      await cache.set(options.cacheKey, options.text, options.private !== true)
    },
  })
}
