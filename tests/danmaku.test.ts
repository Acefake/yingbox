import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createCommentCache } from '../src/main/danmaku/comment-cache'
import { hashForMatch } from '../src/main/danmaku/file-hash'
import {
  COMMENT_CACHE_TTL_MS,
  MATCH_HASH_BYTES,
  commentColor,
  commentUrl,
  dandanHeaders,
  dandanSignature,
  hasCredentials,
  httpErrorMessage,
  isCacheFresh,
  matchFileName,
  matchRequestBody,
  parseComments,
  parseMatchResponse,
  parseSearchResponse,
  searchEpisodesUrl,
  signaturePath,
} from '../src/main/danmaku/rules'
import { createDanmakuService } from '../src/main/danmaku/service'
import {
  AUTO_MATCH_TTL_MS,
  type DanmakuBinding,
  entryKey,
  isBindingFresh,
  isBlocked,
  parseBlockWords,
  parseEpisodeNumber,
  pickSearchMatch,
  pluginLook,
  prepareComments,
  sanitizeBindings,
  searchParams,
  seriesKey,
  upsertBinding,
} from '../src/renderer/src/features/player/danmaku/danmaku-rules'

describe('弹弹play 签名', () => {
  it('base64(sha256(AppId + Timestamp + Path + AppSecret))，与文档示例参数一致', () => {
    // 文档示例：path=/api/v2/comment/123450001，UTC 2025-01-01 00:00:00 → 1735660800
    expect(
      dandanSignature(
        'your_app_id',
        1735660800,
        '/api/v2/comment/123450001',
        'your_app_secret'
      )
    ).toBe('MNBT8iOsIplI/GSkJEAH3V1AlpTyH1aMPJ1nedenEsw=')
  })

  it('签名路径去掉域名与查询串并转小写', () => {
    expect(
      signaturePath(
        'https://api.dandanplay.net/api/v2/comment/123450001?withRelated=true'
      )
    ).toBe('/api/v2/comment/123450001')
    expect(
      signaturePath('https://api.dandanplay.net/api/v2/Search/Episodes?anime=x')
    ).toBe('/api/v2/search/episodes')
  })

  it('请求头：秒级时间戳，签名只用路径', () => {
    const headers = dandanHeaders(
      { appId: ' your_app_id ', appSecret: 'your_app_secret' },
      'https://api.dandanplay.net/api/v2/comment/123450001?withRelated=true',
      1735660800_999
    )
    expect(headers['X-AppId']).toBe('your_app_id')
    expect(headers['X-Timestamp']).toBe('1735660800')
    expect(headers['X-Signature']).toBe(
      'MNBT8iOsIplI/GSkJEAH3V1AlpTyH1aMPJ1nedenEsw='
    )
  })

  it('凭据要 AppId 与 AppSecret 都有', () => {
    expect(hasCredentials({ appId: 'a', appSecret: 'b' })).toBe(true)
    expect(hasCredentials({ appId: 'a', appSecret: ' ' })).toBe(false)
    expect(hasCredentials({})).toBe(false)
  })

  it('没填凭据时不发请求，直接返回 notConfigured', async () => {
    const service = createDanmakuService({
      credentials: () => ({ appId: '', appSecret: '' }),
      cache: { read: async () => null, write: async () => {} },
    })
    const reply = await service.search('进击的巨人')
    expect(reply.success).toBe(false)
    expect(reply.notConfigured).toBe(true)
  })

  it('403 提示检查凭据', () => {
    expect(httpErrorMessage('HTTP 403: Forbidden')).toMatch(/AppId/)
    expect(httpErrorMessage('timeout')).toBe('timeout')
  })
})

describe('请求参数', () => {
  it('文件识别：文件名去目录和扩展名，hash 小写', () => {
    expect(matchFileName('D:\\Anime\\[Sub] Show - 01.mkv')).toBe(
      '[Sub] Show - 01'
    )
    expect(matchFileName('/a/b/noext')).toBe('noext')
    expect(
      matchRequestBody({ filePath: '/a/Show.01.mp4', hash: 'ABC', size: 12.7 })
    ).toEqual({
      fileName: 'Show.01',
      fileHash: 'abc',
      fileSize: 12,
      matchMode: 'hashAndFileName',
    })
  })

  it('搜索地址：集数只接受数字或 C1/S1/O1', () => {
    const url = new URL(searchEpisodesUrl(' 漫长的季节 ', '3'))
    expect(url.pathname).toBe('/api/v2/search/episodes')
    expect(url.searchParams.get('anime')).toBe('漫长的季节')
    expect(url.searchParams.get('episode')).toBe('3')
    expect(
      new URL(searchEpisodesUrl('x', '正片')).searchParams.has('episode')
    ).toBe(false)
    expect(
      new URL(searchEpisodesUrl('x', 'S1')).searchParams.get('episode')
    ).toBe('S1')
  })

  it('取弹幕带第三方关联并转简体', () => {
    expect(commentUrl(42)).toBe(
      'https://api.dandanplay.net/api/v2/comment/42?withRelated=true&chConvert=1'
    )
  })

  it('文件 hash 只取前 16MB', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'yb-danmaku-'))
    const small = join(dir, 'small.bin')
    await fs.writeFile(small, Buffer.from('hello'))
    expect(await hashForMatch(small)).toEqual({
      hash: createHash('md5').update('hello').digest('hex'),
      size: 5,
    })
    const big = join(dir, 'big.bin')
    const data = Buffer.alloc(MATCH_HASH_BYTES + 1024, 7)
    data.fill(9, MATCH_HASH_BYTES)
    await fs.writeFile(big, data)
    const result = await hashForMatch(big)
    expect(result.size).toBe(MATCH_HASH_BYTES + 1024)
    expect(result.hash).toBe(
      createHash('md5').update(data.subarray(0, MATCH_HASH_BYTES)).digest('hex')
    )
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('响应整理', () => {
  it('match：丢掉无效项，精确关联需要有结果', () => {
    expect(
      parseMatchResponse({
        isMatched: true,
        matches: [
          {
            episodeId: 10,
            animeId: 1,
            animeTitle: ' A ',
            episodeTitle: '第1话',
            shift: 1.5,
          },
          { episodeId: 0 },
        ],
      })
    ).toEqual({
      isMatched: true,
      matches: [
        {
          episodeId: 10,
          animeId: 1,
          animeTitle: 'A',
          episodeTitle: '第1话',
          shift: 1.5,
        },
      ],
    })
    expect(parseMatchResponse({ isMatched: true, matches: [] }).isMatched).toBe(
      false
    )
  })

  it('search：整理作品与集', () => {
    expect(
      parseSearchResponse({
        animes: [
          {
            animeId: 5,
            animeTitle: '作品',
            typeDescription: 'TV动画',
            episodes: [
              { episodeId: 50001, episodeTitle: '第1话' },
              { episodeId: -1 },
            ],
          },
          { animeId: 0 },
        ],
      })
    ).toEqual([
      {
        animeId: 5,
        animeTitle: '作品',
        typeDescription: 'TV动画',
        episodes: [{ episodeId: 50001, episodeTitle: '第1话' }],
      },
    ])
  })

  it('comment：p 字段解析时间、模式、颜色，按时间排序', () => {
    expect(
      parseComments({
        count: 4,
        comments: [
          { cid: 1, p: '12.34,1,16777215,123', m: '滚动' },
          { cid: 2, p: '3.5,5,16711680,9', m: '顶部' },
          { cid: 3, p: '8,4,255,9', m: '底部' },
          { cid: 4, p: 'x,1,0,0', m: '坏的' },
          { cid: 5, p: '1,1,0,0', m: '  ' },
        ],
      })
    ).toEqual([
      { time: 3.5, mode: 1, color: '#ff0000', text: '顶部' },
      { time: 8, mode: 2, color: '#0000ff', text: '底部' },
      { time: 12.34, mode: 0, color: '#ffffff', text: '滚动' },
    ])
    expect(commentColor(-1)).toBe('#ffffff')
  })
})

describe('弹幕缓存过期', () => {
  it('7 天内新鲜，过期或未来时间都不算', () => {
    const now = 1_000_000_000_000
    expect(isCacheFresh(now - 1000, now)).toBe(true)
    expect(isCacheFresh(now - COMMENT_CACHE_TTL_MS, now)).toBe(false)
    expect(isCacheFresh(now + 1000, now)).toBe(false)
    expect(isCacheFresh('x', now)).toBe(false)
  })

  it('磁盘缓存读写与过期', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'yb-danmaku-cache-'))
    let now = 1_000_000
    const cache = createCommentCache(dir, () => now)
    const comments = [
      { time: 1, mode: 0 as const, color: '#ffffff', text: 'hi' },
    ]
    expect(await cache.read(7)).toBeNull()
    await cache.write(7, comments)
    expect(await cache.read(7)).toEqual(comments)
    now += COMMENT_CACHE_TTL_MS
    expect(await cache.read(7)).toBeNull()
    await fs.rm(dir, { recursive: true, force: true })
  })
})

describe('匹配参数构造', () => {
  it('集名里取集数', () => {
    expect(parseEpisodeNumber('S01E03')).toBe(3)
    expect(parseEpisodeNumber('第03集')).toBe(3)
    expect(parseEpisodeNumber('第 12 话')).toBe(12)
    expect(parseEpisodeNumber('EP07')).toBe(7)
    expect(parseEpisodeNumber('05')).toBe(5)
    expect(parseEpisodeNumber('正片')).toBeUndefined()
    expect(parseEpisodeNumber(undefined)).toBeUndefined()
  })

  it('条目键：本地按路径，在线按片名 + 集数', () => {
    expect(entryKey({ title: 'X', filePath: 'D:\\a\\b.mkv' })).toBe(
      'file:D:/a/b.mkv'
    )
    expect(entryKey({ title: '漫长的 季节', episode: '第3集' })).toBe(
      'online:漫长的季节#3'
    )
    expect(entryKey({ title: '漫长的季节', episode: '正片', index: 2 })).toBe(
      'online:漫长的季节#2'
    )
    expect(entryKey({ title: '信条' })).toBe('online:信条')
    expect(seriesKey('漫长的季节')).toBe('series:漫长的季节')
  })

  it('搜索参数：作品名不足 2 字不搜；整部剧绑定过作品时用作品名', () => {
    expect(searchParams({ title: '繁花', episode: 'E18' })).toEqual({
      anime: '繁花',
      episode: '18',
    })
    expect(searchParams({ title: 'A' })).toBeNull()
    expect(
      searchParams({ title: '繁花', episode: '第2集' }, 'Blossoms Shanghai')
    ).toEqual({ anime: 'Blossoms Shanghai', episode: '2' })
  })

  it('搜索结果：片名相同优先，限定作品时只看该作品', () => {
    const animes = [
      {
        animeId: 1,
        animeTitle: '进击的巨人 第二季',
        typeDescription: '',
        episodes: [{ episodeId: 11, episodeTitle: '第1话' }],
      },
      {
        animeId: 2,
        animeTitle: '进击的巨人',
        typeDescription: '',
        episodes: [{ episodeId: 21, episodeTitle: '第1话' }],
      },
      { animeId: 3, animeTitle: '空', typeDescription: '', episodes: [] },
    ]
    expect(pickSearchMatch(animes, '进击的巨人')?.episodeId).toBe(21)
    expect(pickSearchMatch(animes, '进击的巨人', 1)?.episodeId).toBe(11)
    expect(pickSearchMatch(animes, '别的')?.episodeId).toBe(11)
    expect(pickSearchMatch([], 'x')).toBeNull()
  })
})

describe('绑定记录', () => {
  const base: DanmakuBinding = {
    key: 'k',
    episodeId: 1,
    animeId: 1,
    animeTitle: 'A',
    episodeTitle: 'E',
    shift: 0,
    manual: false,
    savedAt: 1000,
  }

  it('自动匹配 30 天过期，手动绑定不过期', () => {
    expect(isBindingFresh(base, 1000 + AUTO_MATCH_TTL_MS - 1)).toBe(true)
    expect(isBindingFresh(base, 1000 + AUTO_MATCH_TTL_MS)).toBe(false)
    expect(isBindingFresh({ ...base, manual: true }, 1e15)).toBe(true)
  })

  it('自动匹配不覆盖手动绑定；超出上限先丢最旧的自动匹配', () => {
    const manual = { ...base, manual: true, episodeId: 9 }
    expect(upsertBinding([manual], { ...base, episodeId: 2 })).toEqual([manual])
    const list = upsertBinding(
      [
        { ...base, key: 'old', savedAt: 1 },
        { ...base, key: 'm', manual: true, savedAt: 0 },
      ],
      { ...base, key: 'new', savedAt: 5 },
      2
    )
    expect(list.map(b => b.key)).toEqual(['m', 'new'])
  })

  it('存储里读出的坏数据被丢弃', () => {
    expect(
      sanitizeBindings([null, { key: '' }, { key: 'a', episodeId: 'x' }, base])
    ).toEqual([base])
  })
})

describe('屏蔽词与外观', () => {
  it('屏蔽词：每行 / 逗号分隔，不分大小写，支持 /正则/', () => {
    const rules = parseBlockWords('剧透\n广告, AD\n/^哈+$/\n/[/')
    expect(rules).toHaveLength(4)
    expect(isBlocked('前方剧透预警', rules)).toBe(true)
    expect(isBlocked('this is an ad', rules)).toBe(true)
    expect(isBlocked('哈哈哈', rules)).toBe(true)
    expect(isBlocked('哈哈哈好', rules)).toBe(false)
  })

  it('过滤屏蔽词并加偏移，偏移后早于 0 秒的丢弃', () => {
    const list = [
      { time: 1, mode: 0 as const, color: '#fff', text: '广告位' },
      { time: 2, mode: 0 as const, color: '#fff', text: '好看' },
      { time: 0.5, mode: 0 as const, color: '#fff', text: '早' },
    ]
    expect(prepareComments(list, parseBlockWords('广告'), -1)).toEqual([
      { time: 1, mode: 0, color: '#fff', text: '好看' },
    ])
    expect(prepareComments(list, [])).toHaveLength(3)
  })

  it('设置 → 插件参数', () => {
    expect(
      pluginLook({ opacity: 2, area: 'quarter', speed: 'fast', fontSize: 24.4 })
    ).toEqual({ opacity: 1, margin: [10, '75%'], speed: 3.5, fontSize: 24 })
    expect(
      pluginLook({ opacity: 0.5, area: 'full', speed: 'slow', fontSize: 99 })
        .margin
    ).toEqual([10, 10])
  })
})
