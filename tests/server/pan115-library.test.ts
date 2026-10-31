import { type Mock, describe, expect, it, vi } from 'vitest'
import {
  type Pan115Client,
  create115Client,
} from '../../src/main/pan115/client'
import type { Pan115Service } from '../../src/main/pan115/service'
import { createNetClient } from '../../src/shared/net/client'
import {
  allEntries,
  createPan115Library,
  pan115Root,
} from '../../src/server/netdisk/library'

const session = { cookie: 'UID=test', userId: '1', userName: '测试' }

function fixture(): {
  client: Pan115Client
  sent: string[]
  outbound: Mock<(url: string, init: RequestInit) => Promise<Response>>
  adapter: ReturnType<typeof createPan115Library>
} {
  const sent: string[] = []
  const client = create115Client(async raw => {
    sent.push(raw)
    const url = new URL(raw)
    if (url.pathname === '/files/download')
      return Response.json({
        state: true,
        file_url: 'https://cdn.example/video.mp4',
      })
    if (url.searchParams.get('cid') === '20')
      return Response.json({
        state: true,
        data: [{ fid: '30', n: '电影.mp4', pc: 'play-code', s: 100 }],
      })
    return Response.json({
      state: true,
      data: [{ cid: '20', n: '电影' }],
      path: [],
    })
  }, session)
  const service = {
    use: <T>(run: (client: Pan115Client) => Promise<T>) => run(client),
  } as Pan115Service
  const outbound = vi.fn(
    async (_url: string, _init: RequestInit) =>
      new Response('12', {
        status: 206,
        headers: { 'content-range': 'bytes 0-1/100' },
      })
  )
  const net = createNetClient({
    lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    fetch: outbound,
  })
  return {
    client,
    sent,
    outbound,
    adapter: createPan115Library(() => service, net),
  }
}

describe('115 片库', () => {
  it('只允许专用源的数字根目录', () => {
    expect(pan115Root('yingbox-dav://pan115/123')).toBe('123')
    for (const value of [
      'yingbox-dav://other/123',
      'yingbox-dav://pan115/123/..',
      'yingbox-dav://pan115/name',
      '/media',
    ])
      expect(pan115Root(value)).toBeNull()
  })
  it('未启用和未登录时拒绝入库，返回可理解的参数错误', async () => {
    await expect(
      createPan115Library(() => null).checkRoot('yingbox-dav://pan115/1')
    ).rejects.toThrow('网盘功能未启用')
    const service = {
      use: async () => {
        throw new Error('请先登录 115')
      },
    } as unknown as Pan115Service
    await expect(
      createPan115Library(() => service).checkRoot('yingbox-dav://pan115/1')
    ).rejects.toMatchObject({ code: 'invalid-params', message: '请先登录 115' })
  })
  it('分页读取超过 200 项的目录，不遗漏后续视频', async () => {
    const { client } = fixture()
    const page = Array.from({ length: 200 }, (_, i) => ({
      id: String(i),
      name: `影片${i}.mp4`,
      isDir: false,
      size: 100,
    }))
    const entries = vi
      .spyOn(client, 'entries')
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce([{ ...page[0], id: '201' }])
    expect(await allEntries(client, '10')).toHaveLength(201)
    expect(entries.mock.calls).toEqual([
      ['10', 0],
      ['10', 200],
    ])
  })
  it('远程遍历保留中文文件名，解析子目录 ID，支持取消', async () => {
    const { adapter } = fixture()
    const remote = await adapter.remote('pan115')
    expect(await remote.propfind('/10/电影', 1)).toMatchObject([
      { isDir: true },
      { path: '/10/电影/电影.mp4', isDir: false, size: 100 },
    ])
    await expect(
      remote.propfind('/10', 1, AbortSignal.abort())
    ).rejects.toThrow()
    await expect(remote.propfind('/10/../secret', 1)).rejects.toThrow(
      '路径不合法'
    )
  })
  it('片库视频 Range 代理不携带浏览器令牌或网盘 Cookie', async () => {
    const { adapter, outbound, sent } = fixture()
    const response = await adapter.stream(
      'yingbox-dav://pan115/10/电影/电影.mp4',
      new Request('http://nas/media/files/1', {
        headers: {
          range: 'bytes=0-1',
          cookie: 'nas=secret',
          authorization: 'Bearer secret',
        },
      })
    )
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-1/100')
    expect(await response.text()).toBe('12')
    const headers = new Headers(outbound.mock.calls[0][1]?.headers)
    expect(headers.get('range')).toBe('bytes=0-1')
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('authorization')).toBeNull()
    expect(sent.at(-1)).toContain('pickcode=play-code')
  })
  it('临时播放地址逐跳检查公网，拒绝内网目标', async () => {
    const { client } = fixture()
    vi.spyOn(client, 'downloadUrl').mockResolvedValue('http://127.0.0.1/secret')
    const service = {
      use: <T>(run: (client: Pan115Client) => Promise<T>) => run(client),
    } as Pan115Service
    expect(
      (
        await createPan115Library(() => service).stream(
          'yingbox-dav://pan115/10/电影/电影.mp4',
          new Request('http://nas/media/files/1')
        )
      ).status
    ).toBe(502)
  })
})
