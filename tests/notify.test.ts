/**
 * 入库推送：消息格式、追更标记与去重、类型开关、1 分钟合并、各渠道请求与密钥打码，
 * 以及追更服务在转存过的集入库时交出 landed。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAutograbService } from '../src/main/autograb/service'
import {
  type NotifyFetch,
  sendBark,
  sendTelegram,
} from '../src/main/notify/channels'
import {
  episodeCode,
  formatMessage,
  itemFromArrival,
  redact,
} from '../src/main/notify/notify-rules'
import {
  MERGE_WINDOW_MS,
  type NotifyConfig,
  createNotifyService,
} from '../src/main/notify/notify-service'
import type { LibraryArrival } from '../src/shared/library/arrivals'
import type { CalendarEpisode } from '../src/shared/library/ipc'

const arrival = (patch: Partial<LibraryArrival>): LibraryArrival => ({
  itemId: 1,
  libraryId: 1,
  kind: 'episode',
  topId: 7,
  title: '繁花',
  year: 2023,
  season: 1,
  episode: 5,
  episodeTitle: null,
  matched: true,
  filePath: '/tv/繁花/S01E05.mkv',
  addedAt: 0,
  ...patch,
})

describe('notify-rules', () => {
  it('季集编号与单条消息', () => {
    expect(episodeCode(1, 5)).toBe('S01E05')
    expect(episodeCode(null, 12)).toBe('E12')
    const item = itemFromArrival(arrival({ episodeTitle: '阿宝' }), () => false)
    expect(formatMessage([item])).toEqual({
      title: '新剧集入库',
      body: '繁花 S01E05 · 阿宝',
    })
  })

  it('追更转存的集标成追更；电影带年份', () => {
    expect(
      itemFromArrival(arrival({}), (s, se, e) => s === 7 && se === 1 && e === 5)
        .kind
    ).toBe('autograb')
    const movie = itemFromArrival(
      arrival({
        kind: 'movie',
        itemId: 9,
        title: '沙丘',
        season: null,
        episode: null,
      }),
      () => true
    )
    expect(movie).toEqual({
      kind: 'movie',
      key: 'movie:9',
      title: '沙丘',
      detail: '2023',
    })
  })

  it('多条合成一条：标题写总数，超过 8 行折叠', () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      itemFromArrival(arrival({ episode: i + 1 }), () => false)
    )
    const message = formatMessage(items)
    expect(message.title).toBe('新剧集入库 10 条')
    expect(message.body.split('\n')).toHaveLength(9)
    expect(message.body).toContain('……还有 2 条')
    expect(
      formatMessage([
        items[0],
        itemFromArrival(arrival({ kind: 'movie', title: '沙丘' }), () => false),
      ]).title
    ).toBe('新入库 2 条')
  })

  it('打码', () => {
    expect(
      redact('GET https://api.telegram.org/bot123:abc/sendMessage', ['123:abc'])
    ).toBe('GET https://api.telegram.org/bot***/sendMessage')
  })
})

describe('渠道', () => {
  const recorder = (reply: {
    ok?: boolean
    status?: number
    body?: string
  }): { fetch: NotifyFetch; calls: Array<{ url: string; body: unknown }> } => {
    const calls: Array<{ url: string; body: unknown }> = []
    const fetch: NotifyFetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) })
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        text: async () => reply.body ?? '{}',
      }
    }
    return { fetch, calls }
  }
  const message = { title: '新剧集入库', body: '繁花 S01E05' }

  it('Bark：POST <服务器>/push，带设备 key 与分组', async () => {
    const r = recorder({ body: '{"code":200}' })
    await sendBark(
      r.fetch,
      { server: 'https://bark.nas.lan/', key: 'dev' },
      message
    )
    expect(r.calls).toEqual([
      {
        url: 'https://bark.nas.lan/push',
        body: {
          device_key: 'dev',
          title: '新剧集入库',
          body: '繁花 S01E05',
          group: '影盒',
        },
      },
    ])
    await expect(
      sendBark(r.fetch, { server: 'ftp://x', key: 'dev' }, message)
    ).rejects.toThrow('Bark 服务器地址不对')
  })

  it('Telegram：sendMessage；失败信息里的 token 打码', async () => {
    const ok = recorder({ body: '{"ok":true}' })
    await sendTelegram(ok.fetch, { token: 'T0KEN:xyz', chatId: '42' }, message)
    expect(ok.calls[0]).toEqual({
      url: 'https://api.telegram.org/botT0KEN:xyz/sendMessage',
      body: {
        chat_id: '42',
        text: '新剧集入库\n繁花 S01E05',
        disable_web_page_preview: true,
      },
    })
    const failing: NotifyFetch = async url => {
      throw new Error(`fetch failed: ${url}`)
    }
    await expect(
      sendTelegram(failing, { token: 'T0KEN:xyz', chatId: '42' }, message)
    ).rejects.toThrow(
      'fetch failed: https://api.telegram.org/bot***/sendMessage'
    )
  })
})

describe('推送服务', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(
    patch: Partial<NotifyConfig> = {},
    saved = (): boolean => false
  ): {
    service: ReturnType<typeof createNotifyService>
    shown: string[]
    posted: string[]
    config: NotifyConfig
  } {
    const shown: string[] = []
    const posted: string[] = []
    const config: NotifyConfig = {
      enabled: { system: true, bark: true, telegram: false },
      bark: { server: 'https://api.day.app', key: 'k' },
      telegram: null,
      kinds: { autograb: true, episode: true, movie: true },
      merge: true,
      ...patch,
    }
    const service = createNotifyService({
      config: () => config,
      showSystem: m => void shown.push(`${m.title}|${m.body}`),
      fetch: async (_url, init) => {
        posted.push((JSON.parse(init.body) as { title: string }).title)
        return { ok: true, status: 200, text: async () => '{"code":200}' }
      },
      autograbSaved: saved,
      now: () => Date.now(),
    })
    return { service, shown, posted, config }
  }

  it('1 分钟内的合成一条，发到每个打开的渠道', async () => {
    const { service, shown, posted } = setup()
    service.arrivals([arrival({ episode: 5 })])
    service.arrivals([arrival({ itemId: 2, episode: 6 })])
    expect(shown).toEqual([])
    await vi.advanceTimersByTimeAsync(MERGE_WINDOW_MS)
    expect(shown).toEqual(['新剧集入库 2 条|繁花 S01E05\n繁花 S01E06'])
    expect(posted).toEqual(['新剧集入库 2 条'])
  })

  it('同一集只推一次：片库先到标成追更，追更的 landed 再来不重复', async () => {
    const { service, shown } = setup({ merge: false }, () => true)
    service.arrivals([arrival({})])
    service.landed([
      { seriesId: 7, seriesTitle: '繁花', season: 1, episode: 5 },
    ])
    await vi.runAllTimersAsync()
    expect(shown).toEqual(['追更已入库|繁花 S01E05'])
  })

  it('关掉的类型不推；渠道都没开时什么都不发', async () => {
    const a = setup({
      kinds: { autograb: true, episode: false, movie: true },
      merge: false,
    })
    a.service.arrivals([arrival({})])
    const b = setup({
      enabled: { system: false, bark: false, telegram: false },
      merge: false,
    })
    b.service.arrivals([arrival({})])
    await vi.runAllTimersAsync()
    expect([a.shown, a.posted, b.shown, b.posted]).toEqual([[], [], [], []])
  })

  it('测试推送不看开关，只看有没有填齐', async () => {
    const { service, posted } = setup({
      enabled: { system: false, bark: false, telegram: false },
    })
    await service.test('bark')
    expect(posted).toEqual(['影盒推送测试'])
    await expect(service.test('telegram')).rejects.toThrow('先填 Telegram')
  })
})

describe('追更 landed', () => {
  it('转存过的集在日历里有了文件：交出 landed，isSaved 随之变成 false', async () => {
    const ep = (fileId: number | null): CalendarEpisode => ({
      seriesId: 7,
      libraryId: 1,
      seriesTitle: '繁花',
      season: 1,
      episode: 5,
      title: null,
      airDate: '2026-10-20',
      still: null,
      backdrop: null,
      itemId: null,
      fileId,
      filePath: null,
    })
    let episodes = [ep(null)]
    const landed: string[] = []
    const service = createAutograbService({
      calendar: async () => ({
        episodes,
        configured: true,
        series: 1,
        failed: 0,
      }),
      notify: async () => {},
      pan: {
        loggedIn: () => false,
        pansouReady: () => false,
        search: async () => [],
        snap: async () => ({ title: '', count: 0, files: [] }),
        receive: async () => {},
        entries: async () => [],
        space: async () => ({ total: 0, remain: 0 }),
        remove: async () => {},
        dirPath: async () => [],
      },
      defaultFolder: () => ({ cid: '0', name: '' }),
      load: async () => ({
        version: 1,
        enabled: true,
        series: {
          '7': {
            title: '繁花',
            mode: 'confirm',
            cid: '',
            cidName: '',
            confirmed: 0,
          },
        },
        episodes: {
          '7:1:5': {
            seriesId: 7,
            seriesTitle: '繁花',
            season: 1,
            episode: 5,
            airDate: '2026-10-20',
            status: 'saved',
            attempts: 1,
            savedAt: 1,
          },
        },
      }),
      save: async () => {},
      now: () => Date.parse('2026-10-21T12:00:00Z'),
      sleep: async () => {},
      emit: () => {},
      log: () => {},
      landed: records => landed.push(...records.map(r => r.key)),
    })
    await service.tick()
    expect(service.isSaved(7, 1, 5)).toBe(true)
    expect(landed).toEqual([])
    episodes = [ep(99)]
    await service.tick()
    expect(landed).toEqual(['7:1:5'])
    expect(service.isSaved(7, 1, 5)).toBe(false)
  })
})
