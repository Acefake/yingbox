import { describe, expect, it, vi } from 'vitest'
import type { AiSubtitleCue } from '../src/shared/ai-subtitles/types'
import type { AiMessage } from '../src/shared/ai/types'
import {
  parsePrepareOptions,
  parseProbeOptions,
  parseRequestId,
  parseSaveOptions,
} from '../src/shared/contract/recap'
import {
  CHUNK_TOKENS,
  chunkLines,
  closedChunks,
  cueLines,
} from '../src/shared/recap/budget'
import {
  formatClock,
  qaMessages,
  recapMessages,
  scopeText,
} from '../src/shared/recap/prompts'
import type { RecapContext } from '../src/shared/recap/types'
import { type RecapCache, createRecapCache } from '../src/main/recap/cache'
import type { LocatedMaterial } from '../src/main/recap/sources'
import { createSummarizer, isCancelled } from '../src/main/recap/summarize'

/**
 * 前情提要 / 问剧情的摘要器（AI 全部 mock：分段、缓存复用、取消）、提示词（不剧透）与 IPC 参数校验。
 */

const cue = (sec: number, text: string): AiSubtitleCue => ({
  start: sec * 1000,
  end: sec * 1000 + 900,
  text,
})

describe('摘要器（mock AI）', () => {
  const memoryCache = (): RecapCache =>
    createRecapCache({ read: async () => null, write: async () => {} })

  const located = (
    cues: AiSubtitleCue[],
    key = 'ep:test'
  ): LocatedMaterial => ({
    file: {
      path: '/v/S01E01.mkv',
      show: 'Show',
      season: 1,
      episode: 1,
      label: 'S01E01',
    },
    identity: {
      videoPath: '/v/S01E01.mkv',
      kind: 'subtitle' as const,
      sourcePath: '/v/a.srt',
    },
    key,
    read: vi.fn(async () => ({
      kind: 'subtitle' as const,
      cues,
      bilingual: false,
    })),
  })

  const longCues = Array.from({ length: 600 }, (_, i) =>
    cue(i * 5, `这是第${i}句比较长的台词，用来撑满分段预算`)
  )

  it('短台词一次摘要；长台词分段摘要再合并；第二次全走缓存', async () => {
    const chat = vi.fn(async (messages: AiMessage[]) =>
      messages[0].content.includes('合并') ? '整集摘要' : '段落摘要'
    )
    const summarizer = createSummarizer({ chat, cache: memoryCache() })
    const short = await summarizer.episode(
      'Show',
      located([cue(1, '你好')], 'ep:s'),
      {
        private: false,
      }
    )
    expect(short).toMatchObject({
      text: '段落摘要',
      source: 'subtitle',
      label: 'S01E01',
    })
    expect(chat).toHaveBeenCalledTimes(1)

    chat.mockClear()
    const material = located(longCues, 'ep:l')
    const chunks = chunkLines(cueLines(longCues)).length
    expect(chunks).toBeGreaterThan(1)
    const long = await summarizer.episode('Show', material, { private: false })
    expect(long?.text).toBe('整集摘要')
    expect(chat).toHaveBeenCalledTimes(chunks + 1)
    for (const [messages] of chat.mock.calls)
      expect(messages.map(m => m.content).join('').length).toBeLessThan(
        CHUNK_TOKENS * 2 + 2000
      )

    chat.mockClear()
    await summarizer.episode('Show', material, { private: false })
    expect(chat).not.toHaveBeenCalled()
  })

  it('本集已播部分：复用整集分段缓存，最近台词不超过进度', async () => {
    const chat = vi.fn(async () => '段落摘要')
    const summarizer = createSummarizer({ chat, cache: memoryCache() })
    const material = located(longCues, 'ep:cur')
    const part = await summarizer.current('Show', material, 2000, {
      private: false,
    })
    expect(part.hasSubtitle).toBe(true)
    expect(part.summaries.length).toBeGreaterThan(0)
    expect(part.recent).toContain('第399句')
    expect(part.recent).not.toContain('第400句')
    // 最近台词从已封口段之后开始，不与分段摘要重叠
    const prefix = cueLines(longCues.slice(0, 400))
    const covered = closedChunks(prefix).covered
    expect(covered).toBeGreaterThan(0)
    expect(part.recent).not.toContain(prefix[covered - 1])
    const calls = chat.mock.calls.length
    await summarizer.episode('Show', material, { private: false })
    // 整集摘要只需补算剩下的段 + 合并
    const total = chunkLines(cueLines(longCues)).length
    expect(chat.mock.calls.length - calls).toBe(
      total - part.summaries.length + 1
    )
  })

  it('分集简介不调模型；本集只有简介时不给（防剧透）', async () => {
    const chat = vi.fn(async () => 'x')
    const summarizer = createSummarizer({ chat, cache: memoryCache() })
    const overview = {
      ...located([]),
      identity: {
        videoPath: '/v',
        kind: 'overview' as const,
        sourcePath: '/v.nfo',
      },
      read: async () => ({ kind: 'overview' as const, text: '分集简介' }),
    }
    expect(
      await summarizer.episode('Show', overview, { private: false })
    ).toMatchObject({ text: '分集简介', source: 'overview' })
    expect(
      await summarizer.current('Show', overview, 100, { private: false })
    ).toEqual({ seconds: 100, summaries: [], recent: '', hasSubtitle: false })
    expect(chat).not.toHaveBeenCalled()
  })

  it('私密：模型调用带 private，缓存不落盘', async () => {
    const chat = vi.fn(
      async (_m: AiMessage[], _o: { private: boolean }) => '摘要'
    )
    const write = vi.fn(async () => {})
    const summarizer = createSummarizer({
      chat,
      cache: createRecapCache({ read: async () => null, write }),
    })
    await summarizer.episode('Show', located([cue(1, '你好')], 'ep:p'), {
      private: true,
    })
    expect(chat.mock.calls[0][1].private).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })
})

describe('摘要器取消', () => {
  const memoryCache = (): RecapCache =>
    createRecapCache({ read: async () => null, write: async () => {} })
  const longCues = Array.from({ length: 600 }, (_, i) =>
    cue(i * 5, `这是第${i}句比较长的台词，用来撑满分段预算`)
  )
  const material = (key: string): LocatedMaterial => ({
    file: {
      path: '/v/S01E01.mkv',
      show: 'Show',
      season: 1,
      episode: 1,
      label: 'S01E01',
    },
    identity: {
      videoPath: '/v/S01E01.mkv',
      kind: 'subtitle' as const,
      sourcePath: '/v/a.srt',
    },
    key,
    read: async () => ({
      kind: 'subtitle' as const,
      cues: longCues,
      bilingual: false,
    }),
  })

  it('已取消时一次模型都不调', async () => {
    const chat = vi.fn(async () => '摘要')
    const summarizer = createSummarizer({ chat, cache: memoryCache() })
    const controller = new AbortController()
    controller.abort()
    await expect(
      summarizer.episode('Show', material('ep:a'), {
        private: false,
        signal: controller.signal,
      })
    ).rejects.toSatisfy(isCancelled)
    expect(chat).not.toHaveBeenCalled()
  })

  it('分段途中取消：剩下的段不再发，signal 传给模型调用', async () => {
    const controller = new AbortController()
    const chat = vi.fn(
      async (_m: AiMessage[], options: { signal?: AbortSignal }) => {
        expect(options.signal).toBe(controller.signal)
        controller.abort()
        return '段落摘要'
      }
    )
    const summarizer = createSummarizer({ chat, cache: memoryCache() })
    await expect(
      summarizer.episode('Show', material('ep:b'), {
        private: false,
        signal: controller.signal,
      })
    ).rejects.toSatisfy(isCancelled)
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('共用的计算被别的请求取消时，没取消的请求自己重算', async () => {
    const first = new AbortController()
    let calls = 0
    const chat = vi.fn(
      async (_m: AiMessage[], options: { signal?: AbortSignal }) => {
        calls += 1
        if (calls === 1) {
          // 等第二个请求挂到同一次计算上
          await new Promise(resolve => setTimeout(resolve, 10))
          first.abort()
          if (options.signal?.aborted)
            throw new DOMException('已取消', 'AbortError')
        }
        return '摘要'
      }
    )
    const summarizer = createSummarizer({ chat, cache: memoryCache() })
    const short = (): LocatedMaterial => ({
      ...material('ep:c'),
      read: async () => ({
        kind: 'subtitle' as const,
        cues: [cue(1, '你好')],
        bilingual: false,
      }),
    })
    const a = summarizer.episode('Show', short(), {
      private: false,
      signal: first.signal,
    })
    const b = summarizer.episode('Show', short(), { private: false })
    await expect(a).rejects.toSatisfy(isCancelled)
    await expect(b).resolves.toMatchObject({ text: '摘要' })
  })
})

describe('提示词', () => {
  const context: RecapContext = {
    show: '漫长的季节',
    episode: { label: 'S01E09', season: 1, episode: 9 },
    previous: [
      {
        label: 'S01E07',
        episode: 7,
        season: 1,
        text: '王响发现卷宗',
        source: 'subtitle',
      },
      {
        label: 'S01E08',
        episode: 8,
        season: 1,
        text: '龚彪跑夜车',
        source: 'overview',
      },
    ],
    cacheKey: 'recap:0000000000000000',
  }

  it('前情提要：150–250 字要点，带上之前各集摘要，不透露之后剧情', () => {
    const [system, user] = recapMessages(context)
    expect(system.content).toContain('150–250')
    expect(system.content).toContain('不要推测或透露之后的剧情')
    expect(user.content).toContain('《漫长的季节》')
    expect(user.content).toContain('【S01E07】王响发现卷宗')
    expect(user.content).toContain('【S01E08（分集简介）】')
  })

  it('问剧情：系统提示带进度与不剧透 / 不确定就说不知道，历史有上限', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      text: `第${i}条`,
    }))
    const messages = qaMessages({
      context: {
        ...context,
        current: {
          seconds: 1930,
          summaries: ['开头'],
          recent: '最近台词',
          hasSubtitle: true,
        },
      },
      question: ' 他是谁？ ',
      history,
    })
    const system = messages[0].content
    expect(system).toContain('32:10')
    expect(system).toContain('绝不能透露')
    expect(system).toContain('我不确定')
    expect(system).toContain('最近台词')
    expect(system).toContain('【第 1 段】开头')
    expect(messages.at(-1)).toEqual({ role: 'user', content: '他是谁？' })
    expect(messages.length).toBe(1 + 6 + 1)
  })

  it('时间与范围文案', () => {
    expect(formatClock(65)).toBe('1:05')
    expect(formatClock(3725)).toBe('1:02:05')
    expect(scopeText(context.episode)).toBe('S01E09 之前')
    expect(scopeText(null, 30)).toBe('本片 · 0:30 之前')
  })
})

describe('IPC 参数校验', () => {
  it('prepare：用途必填，问剧情要非负进度', () => {
    expect(parsePrepareOptions({ purpose: 'recap', private: true })).toEqual({
      purpose: 'recap',
      private: true,
    })
    expect(parsePrepareOptions({ purpose: 'qa', seconds: 12.5 })).toEqual({
      purpose: 'qa',
      seconds: 12.5,
    })
    expect(() => parsePrepareOptions({ purpose: 'qa' })).toThrow()
    expect(() => parsePrepareOptions({ purpose: 'x' })).toThrow()
    expect(parseProbeOptions(undefined)).toEqual({})
    expect(() => parseSaveOptions({ cacheKey: 'ep:1', text: 'x' })).toThrow()
    expect(
      parsePrepareOptions({ purpose: 'recap', requestId: 'a1-b2' })
    ).toEqual({ purpose: 'recap', requestId: 'a1-b2' })
    expect(() =>
      parsePrepareOptions({ purpose: 'recap', requestId: 'x y' })
    ).toThrow()
    expect(() => parseRequestId('a'.repeat(65))).toThrow()
  })
})
