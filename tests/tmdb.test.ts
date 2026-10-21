import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOnlineHandlers } from '../src/engine/online'
import type { EngineContext } from '../src/engine/rpc'
import {
  effectiveTmdbToken,
  libraryTokenTarget,
  syncTmdbTokenToLibrary,
} from '../src/main/tmdb'
import { createTokenDraft } from '../src/renderer/src/features/settings/tmdb-token'
import { TMDB_PATH_RE, online } from '../src/shared/contract/online'
import { settings } from '../src/shared/contract/settings'
import { createNetClient } from '../src/shared/net/client'
import type { ProviderStatus } from '../src/shared/library/ipc'

const status = (configured: boolean): ProviderStatus => ({
  tmdb: { configured },
  opensubtitles: { configured: false },
})

describe('TMDB 请求在引擎发出（online.tmdb）', () => {
  const setup = (
    token: string
  ): {
    seen: Array<{ url: string; auth: string | null }>
    ctx: EngineContext
    handlers: ReturnType<typeof createOnlineHandlers>
  } => {
    const seen: Array<{ url: string; auth: string | null }> = []
    const net = createNetClient({
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch: async (url, init) => {
        seen.push({
          url,
          auth: new Headers(init?.headers).get('authorization'),
        })
        return new Response(JSON.stringify({ results: [{ id: 603 }] }), {
          headers: { 'content-type': 'application/json' },
        })
      },
    })
    const ctx = {
      host: vi.fn(async () => token),
      emit: vi.fn(),
    } as unknown as EngineContext
    const handlers = createOnlineHandlers({
      net,
      loadPlugin: async () => '',
    })
    return { seen, ctx, handlers }
  }

  it('向主进程要令牌，带 Bearer 请求 api.themoviedb.org/3 + 路径 + 查询', async () => {
    const { seen, ctx, handlers } = setup('eyJsecret')
    const result = await handlers.tmdb(ctx, '/search/movie', {
      query: '黑客 帝国',
      page: 1,
    })
    expect(result).toEqual({ results: [{ id: 603 }] })
    expect(ctx.host).toHaveBeenCalledWith('tmdbToken')
    expect(seen).toHaveLength(1)
    const url = new URL(seen[0].url)
    expect(url.origin + url.pathname).toBe(
      'https://api.themoviedb.org/3/search/movie'
    )
    expect(url.searchParams.get('query')).toBe('黑客 帝国')
    expect(url.searchParams.get('page')).toBe('1')
    expect(seen[0].auth).toBe('Bearer eyJsecret')
  })

  it('没有令牌返回 null，不出网', async () => {
    const { seen, ctx, handlers } = setup('')
    expect(await handlers.tmdb(ctx, '/movie/603')).toBeNull()
    expect(seen).toHaveLength(0)
  })

  it('契约只放行搜索与详情 / 演职员 / 图片路径，不能当通用代理', () => {
    const parse = online.calls.tmdb.parse
    for (const ok of [
      '/search/movie',
      '/search/tv',
      '/search/multi',
      '/movie/603',
      '/tv/1399/credits',
      '/movie/603/images',
    ]) {
      expect(TMDB_PATH_RE.test(ok)).toBe(true)
      expect(parse([ok, { query: 'x' }])).toEqual([ok, { query: 'x' }])
    }
    for (const bad of [
      '/account',
      '/search/person',
      '/movie/603/videos',
      '//evil.com/x',
      '/movie/603/../../account',
      'https://api.themoviedb.org/3/movie/603',
      '/movie/abc',
    ]) {
      expect(() => parse([bad])).toThrow()
    }
    expect(() => parse(['/movie/1', 'query'])).toThrow()
  })
})

describe('主进程：生效令牌与媒体库引擎同步', () => {
  it('用户填写 > 构建时默认值 > 空', () => {
    expect(effectiveTmdbToken(' eyJuser ', 'eyJenv')).toBe('eyJuser')
    expect(effectiveTmdbToken('  ', 'eyJenv')).toBe('eyJenv')
    expect(effectiveTmdbToken('', '')).toBe('')
  })

  it('引擎未配置、设置里有令牌：下发（去掉首尾空白）', async () => {
    const library = {
      getProviderStatus: vi.fn(async () => status(false)),
      setProviderToken: vi.fn(async () => status(true)),
    }
    expect(await syncTmdbTokenToLibrary(library, ' eyJold ')).toBe(true)
    expect(library.setProviderToken).toHaveBeenCalledWith('eyJold')
  })

  it('引擎已配置：不覆盖', async () => {
    const library = {
      getProviderStatus: vi.fn(async () => status(true)),
      setProviderToken: vi.fn(),
    }
    expect(await syncTmdbTokenToLibrary(library, 'eyJold')).toBe(false)
    expect(library.setProviderToken).not.toHaveBeenCalled()
  })

  it('设置里没有令牌：不查引擎（不为此启动引擎）也不写', async () => {
    const library = {
      getProviderStatus: vi.fn(async () => status(false)),
      setProviderToken: vi.fn(),
    }
    expect(await syncTmdbTokenToLibrary(library, '  ')).toBe(false)
    expect(library.getProviderStatus).not.toHaveBeenCalled()
    expect(library.setProviderToken).not.toHaveBeenCalled()
  })

  it('libraryTokenTarget 映射到引擎方法与参数', async () => {
    const client = { call: vi.fn(async () => status(true)) }
    const target = libraryTokenTarget(client as never)
    await target.getProviderStatus()
    await target.setProviderToken(null)
    expect(client.call.mock.calls).toEqual([
      ['getProviderStatus', undefined],
      ['setProviderToken', { provider: 'tmdb', token: null }],
    ])
  })
})

describe('渲染层：密钥只写不读', () => {
  it('settings 契约没有 readSecret', () => {
    expect(Object.keys(settings.calls)).not.toContain('readSecret')
  })

  it('setSecret 只接受已登记的密钥键与字符串值', () => {
    const parse = settings.calls.setSecret.parse
    expect(parse(['scrape.tmdbToken', 'x'])).toEqual(['scrape.tmdbToken', 'x'])
    expect(parse(['scrape.tmdbToken', ''])).toEqual(['scrape.tmdbToken', ''])
    expect(() => parse(['app.theme', 'dark'])).toThrow()
    expect(() => parse(['scrape.tmdbToken', 1])).toThrow()
  })
})

describe('令牌输入草稿', () => {
  afterEach(() => vi.useRealTimers())

  it('停顿后保存最后一次输入；空草稿不保存', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const draft = createTokenDraft(save, 600)
    draft.input('eyJ')
    vi.advanceTimersByTime(300)
    draft.input('eyJabc')
    vi.advanceTimersByTime(599)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledWith('eyJabc')
    draft.input('')
    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('离开页面：有待保存的输入立即保存；删空后离开不会清掉已保存的令牌', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const draft = createTokenDraft(save, 600)
    draft.input('eyJabc')
    draft.flush()
    expect(save).toHaveBeenCalledWith('eyJabc')
    draft.input('x')
    draft.input('')
    draft.flush()
    vi.advanceTimersByTime(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('clear 清空草稿并清除令牌，取消待保存的输入', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const draft = createTokenDraft(save, 600)
    draft.input('eyJabc')
    draft.clear()
    vi.advanceTimersByTime(1000)
    expect(draft.value.value).toBe('')
    expect(save.mock.calls).toEqual([['']])
  })
})
