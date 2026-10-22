import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type NetClient, createNetClient } from '../src/shared/net/client'
import {
  directExtension,
  downloadDirect,
  parseContentRange,
} from '../src/engine/download/direct'

const lookup = async (): Promise<Array<{ address: string }>> => [
  { address: '93.184.216.34' },
]
const tmp = (): Promise<string> => mkdtemp(join(tmpdir(), 'yb-direct-'))

interface FileServer {
  net: NetClient
  state: {
    skew: number
    body: string
    etag?: string
    cutAt: number
    cleanCut: boolean
    seen: Array<Record<string, string>>
  }
}

/** 假直链服务器：支持 / 不支持 Range，可指定 ETag；`cutAt` 字节处断流（模拟断网）。 */
function fileServer(opts: {
  body: string
  range: boolean
  etag?: string
  /** 不发 Content-Length（分块传输） */
  noLength?: boolean
}): FileServer {
  const state = {
    /** 206 却从别的位置开始（不守规矩的服务器） */
    skew: 0,
    body: opts.body,
    etag: opts.etag,
    cutAt: Infinity,
    /** 断流时正常结束（不报错），只是少了字节 */
    cleanCut: false,
    seen: [] as Array<Record<string, string>>,
  }
  const net = createNetClient({
    lookup,
    fetch: async (_url, init) => {
      const headers = init.headers as Record<string, string>
      state.seen.push(headers)
      const full = Buffer.from(state.body)
      const ifRange = headers['If-Range']
      const m = headers.Range?.match(/^bytes=(\d+)-$/)
      const useRange = opts.range && m && (!ifRange || ifRange === state.etag)
      const start = useRange ? Number(m![1]) : 0
      if (useRange && start >= full.length)
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${full.length}` },
        })
      const part = full.subarray(start)
      const limit = Math.max(0, state.cutAt - start)
      // 先交出 cutAt 之前的字节，下一次读再报错（start 里直接 error 会清掉已排队的数据）
      let sent = false
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          if (!sent) {
            sent = true
            c.enqueue(
              new Uint8Array(part.subarray(0, Math.min(limit, part.length)))
            )
          } else if (limit < part.length && !state.cleanCut)
            c.error(new Error('连接断开'))
          else c.close()
        },
      })
      const h: Record<string, string> = opts.noLength
        ? {}
        : { 'content-length': String(part.length) }
      if (state.etag) h.etag = state.etag
      if (useRange)
        h['content-range'] =
          `bytes ${start + state.skew}-${full.length - 1}/${full.length}`
      return new Response(stream, { status: useRange ? 206 : 200, headers: h })
    },
  })
  return { net, state }
}

describe('直链断点续传（HTTP Range）', () => {
  const body = 'abcdefghijklmnopqrstuvwxyz'.repeat(40)

  it('按扩展名识别直链；解析 Content-Range', () => {
    expect(directExtension('https://c.test/a/b.MP4?x=1')).toBe('mp4')
    expect(directExtension('https://c.test/a/index.m3u8')).toBeUndefined()
    expect(directExtension('not a url')).toBeUndefined()
    expect(parseContentRange('bytes 100-199/1000')).toEqual({
      start: 100,
      total: 1000,
    })
    expect(parseContentRange('bytes 0-9/*')).toEqual({
      start: 0,
      total: undefined,
    })
    expect(parseContentRange(null)).toBeUndefined()
  })

  it('断流后从已写字节续传（Range + If-Range），产物完整、临时文件清掉', async () => {
    const dir = await tmp()
    const server = fileServer({ body, range: true, etag: '"v1"' })
    server.state.cutAt = 300
    await expect(
      downloadDirect(server.net, 'https://c.test/v/a.mp4', join(dir, 'A'), {
        retries: 0,
      })
    ).rejects.toThrow()
    expect((await readFile(join(dir, 'A.mp4.partial'))).length).toBe(300)

    server.state.cutAt = Infinity
    server.state.seen = []
    const progress: Array<number | undefined> = []
    const { file } = await downloadDirect(
      server.net,
      'https://c.test/v/a.mp4?sig=new',
      join(dir, 'A'),
      { retries: 0, onProgress: p => progress.push(p.total) }
    )
    expect(await readFile(file, 'utf-8')).toBe(body)
    expect(server.state.seen[0]).toMatchObject({
      Range: 'bytes=300-',
      'If-Range': '"v1"',
    })
    expect(new Set(progress)).toEqual(new Set([body.length]))
    expect(await readdir(dir)).toEqual(['A.mp4'])
  })

  it('同一次下载里断流按 retries 自动续上', async () => {
    const dir = await tmp()
    const server = fileServer({ body, range: true })
    server.state.cutAt = 500
    let calls = 0
    const net = {
      ...server.net,
      open: (url: string, req?: Parameters<typeof server.net.open>[1]) => {
        if (++calls > 1) server.state.cutAt = Infinity
        return server.net.open(url, req)
      },
    }
    const { file } = await downloadDirect(
      net,
      'https://c.test/v/b.mp4',
      join(dir, 'B'),
      {
        retries: 1,
      }
    )
    expect(await readFile(file, 'utf-8')).toBe(body)
    expect(server.state.seen[1].Range).toBe('bytes=500-')
  })

  it('服务器不支持 Range（回 200）：截断从头写', async () => {
    const dir = await tmp()
    const server = fileServer({ body, range: false })
    server.state.cutAt = 200
    await expect(
      downloadDirect(server.net, 'https://c.test/v/c.mp4', join(dir, 'C'), {
        retries: 0,
      })
    ).rejects.toThrow()
    server.state.cutAt = Infinity
    const { file } = await downloadDirect(
      server.net,
      'https://c.test/v/c.mp4',
      join(dir, 'C'),
      { retries: 0 }
    )
    expect(await readFile(file, 'utf-8')).toBe(body)
  })

  it('文件已变（ETag 不同，If-Range 让服务器回整份）：从头写新内容', async () => {
    const dir = await tmp()
    const server = fileServer({ body, range: true, etag: '"v1"' })
    server.state.cutAt = 200
    await expect(
      downloadDirect(server.net, 'https://c.test/v/d.mp4', join(dir, 'D'), {
        retries: 0,
      })
    ).rejects.toThrow()
    server.state.cutAt = Infinity
    server.state.etag = '"v2"'
    server.state.body = body.toUpperCase()
    const { file } = await downloadDirect(
      server.net,
      'https://c.test/v/d.mp4',
      join(dir, 'D'),
      { retries: 0 }
    )
    expect(await readFile(file, 'utf-8')).toBe(body.toUpperCase())
  })

  it('已全部写完只差改名（416）：直接完成；换了地址不续旧的', async () => {
    const dir = await tmp()
    const server = fileServer({ body, range: true })
    const out = join(dir, 'E')
    await writeFile(`${out}.mp4.partial`, body)
    await writeFile(
      `${out}.mp4.partial.json`,
      JSON.stringify({ v: 1, id: 'https://c.test/v/e.mp4', total: body.length })
    )
    const { file } = await downloadDirect(
      server.net,
      'https://c.test/v/e.mp4',
      out,
      {
        retries: 0,
      }
    )
    expect(await readFile(file, 'utf-8')).toBe(body)
    expect(server.state.seen.map(h => h.Range)).toEqual([
      `bytes=${body.length}-`,
    ])

    const dir2 = await tmp()
    const other = join(dir2, 'F')
    await writeFile(`${other}.mp4.partial`, 'zzzz')
    await writeFile(
      `${other}.mp4.partial.json`,
      JSON.stringify({ v: 1, id: 'https://c.test/v/old.mp4' })
    )
    server.state.seen = []
    await downloadDirect(server.net, 'https://c.test/v/f.mp4', other, {
      retries: 0,
    })
    expect(server.state.seen[0].Range).toBeUndefined()
    expect(await readFile(`${other}.mp4`, 'utf-8')).toBe(body)
  })
})

describe('直链：响应比声明的短', () => {
  it('连接正常结束但字节不够：判失败、保留 .partial，下次续上', async () => {
    const body = 'abcdefghijklmnopqrstuvwxyz'.repeat(40)
    const dir = await tmp()
    const server = fileServer({ body, range: true })
    server.state.cutAt = 400
    server.state.cleanCut = true
    await expect(
      downloadDirect(server.net, 'https://c.test/v/t.mp4', join(dir, 'T'), {
        retries: 0,
      })
    ).rejects.toThrow('下载不完整')
    expect(await readdir(dir)).toContain('T.mp4.partial')
    server.state.cutAt = Infinity
    const { file } = await downloadDirect(
      server.net,
      'https://c.test/v/t.mp4',
      join(dir, 'T'),
      { retries: 0 }
    )
    expect(await readFile(file, 'utf-8')).toBe(body)
  })
})

describe('直链：206 起点对不上', () => {
  it('Content-Range 起点不是已有字节数：丢掉旧数据从头下', async () => {
    const body = 'abcdefghijklmnopqrstuvwxyz'.repeat(40)
    const dir = await tmp()
    const server = fileServer({ body, range: true, etag: '"v1"' })
    server.state.cutAt = 300
    await expect(
      downloadDirect(server.net, 'https://c.test/v/s.mp4', join(dir, 'S'), {
        retries: 0,
      })
    ).rejects.toThrow()
    server.state.cutAt = Infinity
    server.state.skew = 10
    server.state.seen = []
    const { file } = await downloadDirect(
      server.net,
      'https://c.test/v/s.mp4',
      join(dir, 'S'),
      { retries: 0 }
    )
    expect(await readFile(file, 'utf-8')).toBe(body)
    expect(server.state.seen.map(h => h.Range)).toEqual([
      'bytes=300-',
      undefined,
    ])
  })
})

describe('直链：服务器不给 Content-Length', () => {
  it('进度不报总量（不再显示 100%），只报已下字节', async () => {
    const dir = await tmp()
    const body = 'CHUNKED'.repeat(50)
    const server = fileServer({ body, range: false, noLength: true })
    const progress: Array<{ total?: number; bytes: number }> = []

    const { file } = await downloadDirect(
      server.net,
      'https://c.test/v/n.mp4',
      join(dir, 'N'),
      { retries: 0, onProgress: p => progress.push(p) }
    )

    expect(await readFile(file, 'utf-8')).toBe(body)
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every(p => p.total === undefined)).toBe(true)
    expect(progress.at(-1)!.bytes).toBe(body.length)
  })
})
