/**
 * 主进程前情提要 / 问剧情模块入口：组装素材定位（sources）、摘要（summarize）与缓存（cache），注册 recap 域 IPC。
 *
 * - 只处理本地文件（local:// 地址）；在线播放不支持。
 * - 摘要经 aiService().chat 发出，私密内容带 private（按设置只用本地模型），缓存只放内存、不联网查 TMDB。
 * - 最终的前情提要 / 回答由渲染层流式生成（ai.chat），这里只准备上下文并缓存结果。
 * - prepare 按「窗口 + requestId」登记，recap.cancel 或窗口销毁时中止，剩下的分段摘要不再发。
 */
import { type WebContents, app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  RecapContext,
  RecapEpisodeRef,
  RecapEpisodeSummary,
  RecapPrepareOptions,
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
import { type Gathered, gatherMaterial, gatheredCacheKey } from './gather'
import { type LocatedMaterial, type SourceDeps, redactToken } from './sources'

const TMDB_API = 'https://api.themoviedb.org/3'

/**
 * TMDB 分集简介：先中文，没有再英文。
 * v4 读访问令牌（eyJ 开头）走 Bearer；v3 API Key 只能放在 URL 的 api_key 里。
 * fetchHttp 的错误不带 URL，这里仍对抛出的信息脱敏，避免令牌进日志。
 */
async function tmdbOverview(
  tvId: string,
  season: number,
  episode: number
): Promise<string | null> {
  const token = effectiveTmdbToken(settingsStore().getSecret(TMDB_SECRET))
  if (!token) return null
  const bearer = token.startsWith('eyJ')
  try {
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
  } catch (error) {
    throw new Error(
      redactToken(error instanceof Error ? error.message : String(error), token)
    )
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

const refOf = (item: LocatedMaterial): RecapEpisodeRef => ({
  label: item.file.label,
  episode: item.file.episode,
  ...(item.file.season === undefined ? {} : { season: item.file.season }),
})

/** 本地地址 → 素材汇总；不是本地文件时返回 null */
async function gather(
  localUrl: string,
  isPrivate: boolean,
  withCurrent: boolean
): Promise<Gathered | null> {
  const videoPath = localUrlToFilePath(localUrl)
  if (!videoPath) return null
  return gatherMaterial(videoPath, sourceDeps, { isPrivate, withCurrent })
}

/** 渲染层发起、还没结束的 prepare：键为「webContents id:requestId」 */
const inflight = new Map<string, AbortController>()

/** 登记一次 prepare 的取消器；窗口销毁时一并取消 */
function track(
  sender: WebContents,
  requestId: string | undefined
): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController()
  if (!requestId) return { signal: controller.signal, done: () => {} }
  const key = `${sender.id}:${requestId}`
  inflight.get(key)?.abort()
  inflight.set(key, controller)
  const onDestroyed = (): void => controller.abort()
  sender.once('destroyed', onDestroyed)
  return {
    signal: controller.signal,
    done: () => {
      if (inflight.get(key) === controller) inflight.delete(key)
      sender.removeListener('destroyed', onDestroyed)
    },
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
        await aiService().chat(
          {
            messages,
            maxTokens: options.maxTokens,
            private: options.private,
            temperature: 0.3,
            timeoutMs: 180_000,
          },
          { signal: options.signal }
        )
      ).content,
    warn: message => console.warn('[recap]', message),
  })

  /** 准备上下文：之前各集顺序摘要（避免本地模型被并发压垮），问剧情再加本集已播部分 */
  const prepare = async (
    localUrl: string,
    options: RecapPrepareOptions,
    signal: AbortSignal
  ): Promise<RecapContext> => {
    const isPrivate = options.private === true
    const qa = options.purpose === 'qa'
    const found = await gather(localUrl, isPrivate, qa)
    if (!found) throw new Error('前情提要只支持本地视频文件')
    const call = { private: isPrivate, signal }
    const previous: RecapEpisodeSummary[] = []
    for (const item of found.previous) {
      const summary = await summarizer.episode(found.show, item, call)
      if (summary) previous.push(summary)
    }
    const context: RecapContext = {
      show: found.show,
      episode: found.episode,
      previous,
      cacheKey: gatheredCacheKey(found),
    }
    if (qa)
      context.current = await summarizer.current(
        found.show,
        found.current,
        options.seconds ?? 0,
        call
      )
    return context
  }

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
      const cacheKey = gatheredCacheKey(found)
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

    prepare: async ({ sender }, localUrl, options): Promise<RecapContext> => {
      const { signal, done } = track(sender, options.requestId)
      try {
        return await prepare(localUrl, options, signal)
      } finally {
        done()
        // 这次 prepare 里新写的摘要合并成一次落盘（不阻塞返回）
        void cache.flush().catch(error => {
          console.warn('[recap] 写摘要缓存失败', error)
        })
      }
    },

    cancel: ({ sender }, requestId) => {
      const controller = inflight.get(`${sender.id}:${requestId}`)
      controller?.abort()
      return Boolean(controller)
    },

    save: async (_, options) => {
      await cache.set(options.cacheKey, options.text, options.private !== true)
      await cache.flush()
    },
  })
}
