/**
 * 按来源分页面：电影页只查 tmdb 库、番号页只查 jav 库。
 * 覆盖参数校验、SQL 过滤，以及两种 transport（preload IPC、网页端 HTTP）原样转发 source。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type InvokeResult,
  LIBRARY_CHANNELS,
  type LibraryQuery,
  normalizeLibraryQuery,
} from '../../../src/shared/library/ipc'
import { handleRpc } from '../../../src/main/library/engine/rpc'
import { LibraryService } from '../../../src/main/library/engine/service'
import { createLibraryBridge } from '../../../src/preload/library-bridge'
import { createHttpLibraryBridge } from '../../../src/renderer/src/features/library/api/http-bridge'
import { tempTree } from './helpers'

describe('normalizeLibraryQuery 的 source', () => {
  it('缺省不过滤；tmdb / jav 原样保留；其它值拒绝', () => {
    expect(normalizeLibraryQuery({}).source).toBeUndefined()
    expect(normalizeLibraryQuery({ source: 'jav' }).source).toBe('jav')
    expect(normalizeLibraryQuery({ source: 'tmdb' }).source).toBe('tmdb')
    expect(() => normalizeLibraryQuery({ source: 'JAV' })).toThrow(
      expect.objectContaining({ code: 'invalid-params' })
    )
  })
})

describe('按来源查询（真实服务 + preload bridge）', () => {
  let movies: ReturnType<typeof tempTree>
  let jav: ReturnType<typeof tempTree>
  let service: LibraryService

  beforeEach(async () => {
    movies = tempTree()
    jav = tempTree()
    service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
  })
  afterEach(async () => {
    await service.close()
    movies.cleanup()
    jav.cleanup()
  })

  function bridge(): ReturnType<typeof createLibraryBridge> {
    return createLibraryBridge({
      async invoke(channel, method, params): Promise<InvokeResult> {
        expect(channel).toBe(LIBRARY_CHANNELS.invoke)
        const response = await handleRpc(service, { id: 1, method, params })
        return response.ok
          ? { ok: true, result: response.result }
          : { ok: false, error: response.error }
      },
      // 本测试不订阅事件
      send: () => undefined,
      on: () => undefined,
    })
  }

  it('电影页（tmdb）看不到番号条目，番号页（jav）只看到番号条目', async () => {
    movies.write('Alien (1979)/Alien (1979).mkv')
    jav.write('ABC-123/ABC-123.mp4')
    jav.write('XYZ-456.mp4')
    const api = bridge()
    // 不自动识别：测试不发网络请求
    const off = { identify: false, watch: false }
    await api.addLibrary({ root: movies.root, kind: 'movie', automation: off })
    await api.addLibrary({
      root: jav.root,
      kind: 'movie',
      source: 'jav',
      automation: off,
    })
    await service.queue.idle()

    const titles = async (q: LibraryQuery): Promise<string[]> =>
      (await api.query({ types: ['movie'], ...q })).items.map(i => i.title)
    expect(await titles({ source: 'tmdb' })).toEqual(['Alien'])
    const javTitles = await titles({ source: 'jav' })
    expect(javTitles).toHaveLength(2)
    expect(javTitles).not.toContain('Alien')
    // 不带 source 两边都有（演员库等内部用途）
    expect(await titles({})).toHaveLength(3)
    // 统计与待确认同样按来源
    const review = await api.query({
      types: ['movie'],
      source: 'tmdb',
      matchStates: ['review', 'unmatched'],
      limit: 1,
    })
    expect(review.total).toBe(1)
  })
})

describe('网页端 transport 原样转发 source', () => {
  it('query 的 source 进 RPC 参数', async () => {
    const bodies: unknown[] = []
    const api = createHttpLibraryBridge({
      request: async (_path, init) => {
        bodies.push(JSON.parse(String(init.body)))
        return Response.json({
          ok: true,
          result: { items: [], total: 0, offset: 0, limit: 1 },
        })
      },
      openEvents: () => ({ close: () => undefined }),
    })
    await api.query({ types: ['movie'], source: 'jav', limit: 1 })
    expect(bodies).toEqual([
      {
        method: 'query',
        params: { types: ['movie'], source: 'jav', limit: 1 },
      },
    ])
  })
})
