import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { type NetClient, createNetClient } from '../src/shared/net/client'
import { downloadHls } from '../src/engine/download/hls'
import { remuxToMp4 } from '../src/engine/download/index'
import { DownloadQueue } from '../src/engine/download/queue'
import { discardResumeTemps } from '../src/engine/download/resume'
import {
  hasPendingDownloads,
  resumePendingDownloads,
} from '../src/main/engine/pending-downloads'

const lookup = async (): Promise<Array<{ address: string }>> => [
  { address: '93.184.216.34' },
]
const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'yb-resume-'))
const exists = (p: string): Promise<boolean> =>
  readFile(p).then(
    () => true,
    () => false
  )

interface HlsServer {
  net: NetClient
  state: { failFrom: number; requested: string[] }
  expected: string
}

/** 假 HLS 服务器：记录每个被请求的地址；`failFrom` 之后的分片一律 500（模拟中途断网 / 崩溃）。 */
function hlsServer(opts: {
  segments: number
  map?: boolean
  query?: string
}): HlsServer {
  const seg = (i: number): string => `S${i}-`.repeat(3)
  const q = opts.query ?? ''
  const playlist = [
    '#EXTM3U\n',
    opts.map ? '#EXT-X-MAP:URI="init.mp4"\n' : '',
    ...Array.from(
      { length: opts.segments },
      (_, i) => `#EXTINF:1,\ns${i}.ts${q}\n`
    ),
  ].join('')
  const state = { failFrom: Infinity, requested: [] as string[] }
  const net = createNetClient({
    lookup,
    fetch: async url => {
      const path = new URL(url).pathname
      state.requested.push(path)
      if (path.endsWith('.m3u8')) return new Response(playlist)
      if (path.endsWith('init.mp4')) return new Response('INIT-')
      const i = Number(path.match(/s(\d+)\.ts$/)?.[1])
      if (i >= state.failFrom) return new Response('x', { status: 500 })
      return new Response(seg(i))
    },
  })
  const expected =
    (opts.map ? 'INIT-' : '') +
    Array.from({ length: opts.segments }, (_, i) => seg(i)).join('')
  return { net, state, expected }
}

const segRequests = (requested: string[]): string[] =>
  requested.filter(p => /\.(ts|mp4)$/.test(p))

describe('HLS 断点续传', () => {
  it('中途失败保留 .partial 与分片记录；再次下载只拉剩下的分片，产物与一次下完相同', async () => {
    const dir = await tmp()
    const server = hlsServer({ segments: 8 })
    server.state.failFrom = 5
    await expect(
      downloadHls(server.net, 'https://cdn.test/v/i.m3u8', join(dir, 'A'), {
        retries: 0,
        concurrency: 2,
      })
    ).rejects.toThrow('HTTP 500')
    expect((await readdir(dir)).sort()).toEqual([
      'A.ts.partial',
      'A.ts.partial.segs',
    ])

    server.state.failFrom = Infinity
    server.state.requested = []
    const progress: Array<[number, number | undefined]> = []
    const result = await downloadHls(
      server.net,
      'https://cdn.test/v/i.m3u8',
      join(dir, 'A'),
      { retries: 0, onProgress: p => progress.push([p.done, p.total]) }
    )
    expect(await readFile(result.file, 'utf-8')).toBe(server.expected)
    expect(segRequests(server.state.requested)).toEqual([
      '/v/s5.ts',
      '/v/s6.ts',
      '/v/s7.ts',
    ])
    // 续上时先报一次已有进度，再接着报
    expect(progress).toEqual([
      [5, 8],
      [6, 8],
      [7, 8],
      [8, 8],
    ])
    expect(await readdir(dir)).toEqual(['A.ts'])
  })

  it('fMP4：初始化段算第一个单元，续传不重复写', async () => {
    const dir = await tmp()
    const server = hlsServer({ segments: 4, map: true })
    server.state.failFrom = 2
    await expect(
      downloadHls(server.net, 'https://cdn.test/v/i.m3u8', join(dir, 'M'), {
        retries: 0,
        concurrency: 1,
      })
    ).rejects.toThrow()
    server.state.failFrom = Infinity
    server.state.requested = []
    const result = await downloadHls(
      server.net,
      'https://cdn.test/v/i.m3u8',
      join(dir, 'M'),
      { retries: 0 }
    )
    expect(result.container).toBe('mp4')
    expect(await readFile(result.file, 'utf-8')).toBe(server.expected)
    expect(segRequests(server.state.requested)).toEqual([
      '/v/s2.ts',
      '/v/s3.ts',
    ])
  })

  it('校验已下分片：磁盘上被改坏的分片及其后全部重下；记录之外的尾部残片被截掉', async () => {
    const dir = await tmp()
    const server = hlsServer({ segments: 6 })
    server.state.failFrom = 4
    await expect(
      downloadHls(server.net, 'https://cdn.test/v/i.m3u8', join(dir, 'C'), {
        retries: 0,
        concurrency: 1,
      })
    ).rejects.toThrow()
    const partial = join(dir, 'C.ts.partial')
    const buf = await readFile(partial)
    buf[buf.length - 13] ^= 0xff // 改坏第 3 个分片（序号 2）里的一个字节
    // 尾部追加一大段记录之外的残片（数据写了、记录没来得及写时崩溃），比剩下的分片总长还长
    await writeFile(partial, Buffer.concat([buf, Buffer.alloc(1000, 0x47)]))

    server.state.failFrom = Infinity
    server.state.requested = []
    const result = await downloadHls(
      server.net,
      'https://cdn.test/v/i.m3u8',
      join(dir, 'C'),
      { retries: 0 }
    )
    expect(await readFile(result.file, 'utf-8')).toBe(server.expected)
    expect(segRequests(server.state.requested)).toEqual([
      '/v/s2.ts',
      '/v/s3.ts',
      '/v/s4.ts',
      '/v/s5.ts',
    ])
  })

  it('分片地址只换了签名参数照样续传；分片列表变了从头下', async () => {
    const dir = await tmp()
    const first = hlsServer({ segments: 5, query: '?t=1' })
    first.state.failFrom = 3
    await expect(
      downloadHls(first.net, 'https://cdn.test/v/i.m3u8', join(dir, 'Q'), {
        retries: 0,
        concurrency: 1,
      })
    ).rejects.toThrow()
    const resigned = hlsServer({ segments: 5, query: '?t=2' })
    await downloadHls(
      resigned.net,
      'https://cdn.test/v/i.m3u8',
      join(dir, 'Q'),
      {
        retries: 0,
      }
    )
    expect(segRequests(resigned.state.requested)).toEqual([
      '/v/s3.ts',
      '/v/s4.ts',
    ])

    const dir2 = await tmp()
    const old = hlsServer({ segments: 5 })
    old.state.failFrom = 3
    await expect(
      downloadHls(old.net, 'https://cdn.test/v/i.m3u8', join(dir2, 'R'), {
        retries: 0,
        concurrency: 1,
      })
    ).rejects.toThrow()
    const changed = hlsServer({ segments: 6 })
    const result = await downloadHls(
      changed.net,
      'https://cdn.test/v/i.m3u8',
      join(dir2, 'R'),
      { retries: 0 }
    )
    expect(segRequests(changed.state.requested)).toHaveLength(6)
    expect(await readFile(result.file, 'utf-8')).toBe(changed.expected)
  })

  it('成品已在且没有 .partial（改名后、转封装前被打断）：不再下载', async () => {
    const dir = await tmp()
    await writeFile(join(dir, 'D.ts'), 'DONE')
    const server = hlsServer({ segments: 3 })
    const result = await downloadHls(
      server.net,
      'https://cdn.test/v/i.m3u8',
      join(dir, 'D')
    )
    expect(result.file).toBe(join(dir, 'D.ts'))
    expect(segRequests(server.state.requested)).toEqual([])
    expect(await readFile(result.file, 'utf-8')).toBe('DONE')
  })

  it('取消后保留进度，续传接得上', async () => {
    const dir = await tmp()
    const server = hlsServer({ segments: 6 })
    const controller = new AbortController()
    await expect(
      downloadHls(server.net, 'https://cdn.test/v/i.m3u8', join(dir, 'X'), {
        concurrency: 1,
        signal: controller.signal,
        onProgress: p => p.done === 3 && controller.abort(),
      })
    ).rejects.toThrow()
    server.state.requested = []
    const result = await downloadHls(
      server.net,
      'https://cdn.test/v/i.m3u8',
      join(dir, 'X')
    )
    expect(await readFile(result.file, 'utf-8')).toBe(server.expected)
    expect(segRequests(server.state.requested)[0]).toBe('/v/s3.ts')
  })
})

describe('下载域接线（createDownloadHandlers）', () => {
  it('站点给直链走 Range 下载器；移除失败任务时清掉它的续传临时文件', async () => {
    const root = await tmp()
    const body = 'MP4DATA'.repeat(100)
    const net = createNetClient({
      lookup,
      fetch: async url => {
        if (url.startsWith('https://jable.tv/videos/good-1/'))
          return new Response("var hlsUrl = 'https://cdn.test/v/good.mp4';")
        if (url === 'https://cdn.test/v/good.mp4') return new Response(body)
        return new Response('nf', { status: 404 })
      },
    })
    const { createDownloadHandlers } =
      await import('../src/engine/download/index')
    const ctx = {
      emit: () => {},
      busy: () => {},
      host: (async () => root) as never,
    }
    const { queue } = createDownloadHandlers({
      net,
      stateFile: join(root, 'queue.json'),
      ctx,
    })
    await mkdir(join(root, 'BAD-1'))
    await writeFile(join(root, 'BAD-1', 'BAD-1.ts.partial'), 'half')
    queue.add('good-1')
    queue.add('bad-1')
    await vi.waitFor(() => {
      const snap = queue.snapshot()
      expect(snap.completed.map(t => t.file)).toEqual([
        join(root, 'GOOD-1', 'GOOD-1.mp4'),
      ])
      expect(snap.failed.map(t => t.id)).toEqual(['BAD-1'])
    })
    expect(await readFile(join(root, 'GOOD-1', 'GOOD-1.mp4'), 'utf-8')).toBe(
      body
    )
    queue.remove('bad-1')
    await vi.waitFor(async () =>
      expect((await readdir(root)).sort()).toEqual(['GOOD-1', 'queue.json'])
    )
  })
})

describe('转封装与临时文件清理', () => {
  const fakeFfmpeg = async (dir: string, ok: boolean): Promise<string> => {
    const bin = join(dir, 'ffmpeg')
    // 参数最后一个是输出：成功时把输入（-i 后一个）拷过去
    await writeFile(
      bin,
      ok
        ? '#!/bin/sh\nin=""; prev=""; for a; do [ "$prev" = "-i" ] && in="$a"; prev="$a"; out="$a"; done; cp "$in" "$out"\n'
        : '#!/bin/sh\nfor a; do out="$a"; done; echo half > "$out"; exit 1\n'
    )
    await chmod(bin, 0o755)
    return bin
  }

  it.skipIf(process.platform === 'win32')(
    'ffmpeg 先写 .mp4.partial 再改名；失败保留 .ts、不留半个 mp4',
    async () => {
      const dir = await tmp()
      await writeFile(join(dir, 'A.ts'), 'TS')
      expect(
        await remuxToMp4(join(dir, 'A.ts'), await fakeFfmpeg(dir, true))
      ).toBe(join(dir, 'A.mp4'))
      expect((await readdir(dir)).sort()).toEqual(['A.mp4', 'ffmpeg'])
      expect(await readFile(join(dir, 'A.mp4'), 'utf-8')).toBe('TS')

      const dir2 = await tmp()
      await writeFile(join(dir2, 'B.ts'), 'TS')
      expect(
        await remuxToMp4(join(dir2, 'B.ts'), await fakeFfmpeg(dir2, false))
      ).toBe(join(dir2, 'B.ts'))
      expect((await readdir(dir2)).sort()).toEqual(['B.ts', 'ffmpeg'])
    }
  )

  it('丢弃续传临时文件：只删 .partial 及其记录；目录空了一并删', async () => {
    const root = await tmp()
    const a = join(root, 'A')
    await mkdir(a)
    for (const n of [
      'A.ts.partial',
      'A.ts.partial.segs',
      'A.mp4.partial',
      'A.mp4.partial.json',
    ])
      await writeFile(join(a, n), 'x')
    await discardResumeTemps(a)
    expect(await readdir(root)).toEqual([])

    const b = join(root, 'B')
    await mkdir(b)
    await writeFile(join(b, 'B.ts'), 'done')
    await writeFile(join(b, 'B.mp4.partial'), 'x')
    await discardResumeTemps(b)
    expect(await readdir(b)).toEqual(['B.ts'])
    await expect(
      discardResumeTemps(join(root, 'missing'))
    ).resolves.toBeUndefined()
  })

  it('队列移除：未完成的任务丢临时文件，进行中的等下载停下才丢，已完成的不动', async () => {
    const file = join(await tmp(), 'queue.json')
    const discarded: string[] = []
    let stopped = false
    const queue = new DownloadQueue({
      file,
      onChange: () => {},
      discard: async code => {
        discarded.push(code === 'RUN-1' ? `${code}:${stopped}` : code)
      },
      run: (code, _r, signal) =>
        code === 'OK-1'
          ? Promise.resolve({ file: 'f', site: 's' })
          : code === 'BAD-1'
            ? Promise.reject(new Error('x'))
            : new Promise((_, reject) =>
                signal.addEventListener('abort', () =>
                  setTimeout(() => {
                    stopped = true
                    reject(new Error('aborted'))
                  }, 5)
                )
              ),
    })
    queue.add('ok-1')
    queue.add('bad-1')
    await new Promise(r => setTimeout(r, 10))
    queue.add('run-1')
    queue.add('wait-1')
    queue.remove('ok-1')
    queue.remove('bad-1')
    queue.remove('wait-1')
    queue.remove('run-1')
    expect(discarded).toEqual(['BAD-1', 'WAIT-1'])
    await new Promise(r => setTimeout(r, 20))
    expect(discarded).toEqual(['BAD-1', 'WAIT-1', 'RUN-1:true'])
  })
})

describe('启动时续下', () => {
  it('队列文件里有等待中 / 进行中的任务才唤醒引擎', async () => {
    const dir = await tmp()
    const file = join(dir, 'queue.json')
    expect(await hasPendingDownloads(file)).toBe(false)
    await writeFile(file, '{oops')
    expect(await hasPendingDownloads(file)).toBe(false)
    await writeFile(
      file,
      JSON.stringify({ tasks: [{ status: 'done' }, { status: 'failed' }] })
    )
    let woke = 0
    expect(await resumePendingDownloads(file, async () => woke++)).toBe(false)
    expect(woke).toBe(0)
    await writeFile(file, JSON.stringify({ tasks: [{ status: 'active' }] }))
    expect(await resumePendingDownloads(file, async () => woke++)).toBe(true)
    await writeFile(file, JSON.stringify({ tasks: [{ status: 'queued' }] }))
    expect(await hasPendingDownloads(file)).toBe(true)
    // 唤醒失败不抛
    await expect(
      resumePendingDownloads(file, () => Promise.reject(new Error('down')))
    ).resolves.toBe(true)
    expect(woke).toBe(1)
    expect(await exists(file)).toBe(true)
  })
})
