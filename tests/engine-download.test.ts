import { createCipheriv } from 'node:crypto'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNetClient } from '../src/shared/net/client'
import {
  downloadHls,
  parseMediaPlaylist,
  pickBestVariant,
  sequenceIv,
} from '../src/engine/download/hls'
import { DownloadQueue, normalizeCode } from '../src/engine/download/queue'
import {
  SITES,
  hohoj,
  jable,
  kanav,
  memo,
  missav,
  resolveSource,
} from '../src/engine/download/sources'

const lookup = async (): Promise<Array<{ address: string }>> => [
  { address: '93.184.216.34' },
]
const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'yb-dl-'))

describe('m3u8 解析', () => {
  it('主清单选最高码率并解析成绝对地址', () => {
    const master = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=842x480
480p/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080
1080p/video.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=1280x720
720p/video.m3u8`
    expect(pickBestVariant(master, 'https://cdn.test/a/playlist.m3u8')).toBe(
      'https://cdn.test/a/1080p/video.m3u8'
    )
  })

  it('媒体清单：序号、AES-128 密钥（含显式 IV）、初始化段、METHOD=NONE 清除密钥', () => {
    const media = `#EXTM3U
#EXT-X-MEDIA-SEQUENCE:7
#EXT-X-MAP:URI="init.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="../key.bin",IV=0x000102030405060708090a0b0c0d0e0f
#EXTINF:5,
s1.m4s
#EXT-X-KEY:METHOD=NONE
#EXTINF:5,
s2.m4s`
    const parsed = parseMediaPlaylist(
      media,
      'https://cdn.test/v/720/index.m3u8'
    )
    expect(parsed.map).toBe('https://cdn.test/v/720/init.mp4')
    expect(parsed.segments.map(s => [s.uri, s.sequence])).toEqual([
      ['https://cdn.test/v/720/s1.m4s', 7],
      ['https://cdn.test/v/720/s2.m4s', 8],
    ])
    expect(parsed.segments[0].key?.uri).toBe('https://cdn.test/v/key.bin')
    expect(parsed.segments[0].key?.iv?.toString('hex')).toBe(
      '000102030405060708090a0b0c0d0e0f'
    )
    expect(parsed.segments[1].key).toBeUndefined()
    expect(() => parseMediaPlaylist('<html>', 'https://x.test/')).toThrow()
    expect(() =>
      parseMediaPlaylist(
        '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\na.ts',
        'https://x.test/'
      )
    ).toThrow('不支持')
  })
})

describe('HLS 下载', () => {
  it('解密 AES-128（默认 IV=序号）、按序拼接、原子落盘、上报进度', async () => {
    const key = Buffer.alloc(16, 7)
    const enc = (text: string, seq: number): Buffer => {
      const c = createCipheriv('aes-128-cbc', key, sequenceIv(seq))
      return Buffer.concat([c.update(text), c.final()])
    }
    const routes: Record<string, Buffer | string> = {
      'https://cdn.test/v/master.m3u8':
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhi/index.m3u8\n',
      'https://cdn.test/v/hi/index.m3u8':
        '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:3\n#EXT-X-KEY:METHOD=AES-128,URI="k.bin"\n#EXTINF:1,\na.ts\n#EXTINF:1,\nb.ts\n#EXTINF:1,\nc.ts\n',
      'https://cdn.test/v/hi/k.bin': key,
      'https://cdn.test/v/hi/a.ts': enc('AAA', 3),
      'https://cdn.test/v/hi/b.ts': enc('BBB', 4),
      'https://cdn.test/v/hi/c.ts': enc('CCC', 5),
    }
    const seenReferer: string[] = []
    const net = createNetClient({
      lookup,
      fetch: async (url, init) => {
        seenReferer.push((init.headers as Record<string, string>).Referer)
        // 乱序完成：后面的分片先回来，验证仍按序写入
        await new Promise(r => setTimeout(r, url.endsWith('a.ts') ? 20 : 0))
        const body = routes[url]
        return new Response(
          typeof body === 'string' ? body : body ? new Uint8Array(body) : 'nf',
          {
            status: body ? 200 : 404,
          }
        )
      },
    })
    const dir = await tmp()
    const progress: number[] = []
    const result = await downloadHls(
      net,
      'https://cdn.test/v/master.m3u8',
      join(dir, 'ABC-1'),
      {
        referer: 'https://site.test/',
        onProgress: p => progress.push(p.done),
      }
    )
    expect(result).toEqual({ file: join(dir, 'ABC-1.ts'), container: 'ts' })
    expect(await readFile(result.file, 'utf-8')).toBe('AAABBBCCC')
    expect(progress).toEqual([1, 2, 3])
    expect(new Set(seenReferer)).toEqual(new Set(['https://site.test/']))
  })

  it('分片失败（重试用尽）时不留成品，保留 .partial 与分片记录供续传', async () => {
    const net = createNetClient({
      lookup,
      fetch: async url =>
        url.endsWith('.m3u8')
          ? new Response('#EXTM3U\n#EXTINF:1,\na.ts\n')
          : new Response('x', { status: 500 }),
    })
    const dir = await tmp()
    await expect(
      downloadHls(net, 'https://cdn.test/i.m3u8', join(dir, 'X'), {
        retries: 0,
      })
    ).rejects.toThrow('HTTP 500')
    expect((await readdir(dir)).sort()).toEqual([
      'X.ts.partial',
      'X.ts.partial.segs',
    ])
  })
})

describe('站点解析（移植自 Python 各 Downloader）', () => {
  it('各站点从页面提取 m3u8', () => {
    expect(jable.parse("var hlsUrl = 'https://j.test/a.m3u8';")).toBe(
      'https://j.test/a.m3u8'
    )
    expect(
      missav.parse(
        'm3u8|123456789abc|5678|abcd|1234|12345678|com|surrit|https|video'
      )
    ).toBe(
      'https://surrit.com/12345678-1234-abcd-5678-123456789abc/playlist.m3u8'
    )
    expect(memo.parse('{"url":"https%3A%2F%2Fm.test%2Fa.m3u8"}')).toBe(
      'https://m.test/a.m3u8'
    )
    const b64 = Buffer.from(
      encodeURIComponent('https://k.test/a.m3u8')
    ).toString('base64')
    expect(kanav.parse(`{"url":"${b64}"}`)).toBe('https://k.test/a.m3u8')
    expect(hohoj.parse('var videoSrc = "https://h.test/a.m3u8"')).toBe(
      'https://h.test/a.m3u8'
    )
    expect(jable.parse('nothing')).toBeUndefined()
  })

  it('按权重依次尝试，第一个成功的站点胜出', async () => {
    expect(SITES.map(s => s.name)).toEqual([
      'Jable',
      'MissAV',
      'Memo',
      'KanAV',
      'HohoJ',
    ])
    const asked: string[] = []
    const get = async (url: string): Promise<string | undefined> => {
      asked.push(url)
      if (url.includes('memojav'))
        return '{"url":"https%3A%2F%2Fm.test%2Fa.m3u8"}'
      return undefined
    }
    await expect(resolveSource('ABC-123', get)).resolves.toEqual({
      site: 'Memo',
      m3u8: 'https://m.test/a.m3u8',
      referer: 'https://memojav.com/',
    })
    expect(asked[0]).toBe('https://jable.tv/videos/abc-123/')
    await expect(
      resolveSource('ABC-123', async () => undefined)
    ).rejects.toThrow('ABC-123')
  })
})

describe('下载队列', () => {
  const setup = async (
    run: ConstructorParameters<typeof DownloadQueue>[0]['run']
  ): Promise<{ queue: DownloadQueue; file: string; snapshots: string[] }> => {
    const file = join(await tmp(), 'queue.json')
    const snapshots: string[] = []
    const queue = new DownloadQueue({
      file,
      downloadDir: async () => '/downloads',
      run,
      onChange: s =>
        snapshots.push(`${s.active?.id ?? '-'}|${s.queued.length}`),
    })
    return { queue, file, snapshots }
  }
  const settle = (): Promise<void> => new Promise(r => setTimeout(r, 10))

  it('番号规范化与校验', () => {
    expect(normalizeCode(' abp-001 ')).toBe('ABP-001')
    expect(normalizeCode('../etc')).toBeUndefined()
    expect(normalizeCode('')).toBeUndefined()
  })

  it('串行下载；已完成 / 已在队列不重复加；失败可重试；状态原子持久化', async () => {
    let concurrent = 0
    let maxConcurrent = 0
    const { queue, file } = await setup(async code => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await new Promise(r => setTimeout(r, 5))
      concurrent--
      if (code === 'BAD-1') throw new Error('没有源')
      return { file: `/v/${code}.mp4`, site: 'Jable' }
    })
    expect(queue.add('a-1')).toEqual({ added: true })
    expect(queue.add('A-1')).toEqual({ added: false, reason: 'queued' })
    expect(queue.add('bad-1')).toEqual({ added: true })
    expect(queue.add('../x')).toEqual({ added: false, reason: 'invalid' })
    await settle()
    await settle()
    expect(maxConcurrent).toBe(1)
    const snap = queue.snapshot()
    expect(snap.completed.map(t => [t.id, t.file])).toEqual([
      ['A-1', '/v/A-1.mp4'],
    ])
    expect(snap.failed.map(t => [t.id, t.error])).toEqual([['BAD-1', '没有源']])
    expect(queue.add('a-1')).toEqual({ added: false, reason: 'exists' })
    await queue.flush()
    const saved = JSON.parse(await readFile(file, 'utf-8'))
    expect(saved.tasks.map((t: { id: string }) => t.id).sort()).toEqual([
      'A-1',
      'BAD-1',
    ])
    expect(queue.retry('bad-1')).toEqual({ added: true })
  })

  it('重启后进行中的任务回到队首继续', async () => {
    const { queue, file } = await setup(() => new Promise(() => {}))
    queue.add('first-1')
    queue.add('second-2')
    await queue.flush()
    const ran: string[] = []
    const restarted = new DownloadQueue({
      file,
      downloadDir: async () => '/downloads',
      run: async code => {
        ran.push(code)
        return { file: code, site: 's' }
      },
      onChange: () => {},
    })
    await restarted.load()
    await settle()
    expect(ran).toEqual(['FIRST-1', 'SECOND-2'])
  })

  it('退出时停止下载：任务不记为失败，保持进行中以便下次启动续下', async () => {
    const { queue, file } = await setup(
      (_code, _report, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        )
    )
    queue.add('y-1')
    queue.stop()
    await settle()
    await queue.flush()
    expect(queue.snapshot().failed).toEqual([])
    const saved = JSON.parse(await readFile(file, 'utf-8'))
    expect(saved.tasks[0]).toMatchObject({ id: 'Y-1', status: 'active' })
  })

  it('移除进行中的任务会取消下载，且不记为失败', async () => {
    let aborted = false
    const { queue } = await setup(
      (_code, _report, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          })
        })
    )
    queue.add('x-1')
    await settle() // 等任务定下目录、runner 跑起来
    queue.remove('x-1')
    await settle()
    expect(aborted).toBe(true)
    expect(queue.snapshot()).toEqual({
      active: undefined,
      queued: [],
      completed: [],
      failed: [],
    })
  })
})
