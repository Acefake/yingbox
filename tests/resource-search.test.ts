import { describe, expect, it, vi } from 'vitest'
import {
  groupResources,
  parseQuery,
  resourceMatch,
  searchAliases,
} from '../src/renderer/src/features/search/rules'
import { SearchSession } from '../src/renderer/src/features/search/session'
import { externalResource } from '../src/renderer/src/features/search/resources'
import type { SearchResource } from '../src/renderer/src/features/search/types'

const resource = (
  key: string,
  patch: Partial<SearchResource> = {}
): SearchResource => ({
  key,
  kind: 'online',
  title: '沙丘 2021',
  workTitle: '沙丘',
  year: 2021,
  type: 'movie',
  sources: [key],
  reason: '未验证',
  ...patch,
})
describe('统一资源搜索匹配', () => {
  it('解析季集、年份和画质，向资源源只发送片名', () => {
    expect(parseQuery('1917')).toMatchObject({
      keyword: '1917',
      year: undefined,
    })
    expect(parseQuery('2001太空漫游')).toMatchObject({
      keyword: '2001太空漫游',
      year: undefined,
    })
    expect(parseQuery('沙丘 (2021) 4K')).toMatchObject({
      keyword: '沙丘',
      year: 2021,
      resolution: '4K',
    })
    expect(parseQuery('黑暗荣耀 (2022) S02E03')).toMatchObject({
      year: 2022,
      season: 2,
      episode: 3,
    })
    expect(parseQuery('黑暗荣耀 S02E03')).toMatchObject({
      keyword: '黑暗荣耀',
      season: 2,
      episode: 3,
    })
  })
  it('同片多源合并，跨年份、类型和冲突 ID 保持独立', () => {
    const list = [
      resource('a', { tmdbId: '1' }),
      resource('b'),
      resource('c', { year: 1984 }),
      resource('d', { type: 'series' }),
      resource('e', { tmdbId: '2' }),
    ]
    const works = groupResources(list, parseQuery('沙丘'))
    expect(works).toHaveLength(4)
    expect(works.find(work => work.key === 'a')?.resources).toHaveLength(2)
  })
  it('同资源去重并保留所有来源，缺少年份与类型不猜测合并', () => {
    const works = groupResources(
      [
        resource('a'),
        resource('a', { sources: ['其他源'] }),
        resource('b', { year: undefined }),
        resource('c', { type: undefined, year: undefined }),
      ],
      parseQuery('沙丘')
    )
    expect(works).toHaveLength(3)
    expect(works[0].resources[0].sources).toEqual(['a', '其他源'])
  })
  it('可信原名对上同年资源后可合并，来源对象不被修改', () => {
    const unknown = resource('share', { type: undefined, workTitle: 'Dune' })
    const works = groupResources(
      [resource('local', { aliases: ['Dune'], tmdbId: '1' }), unknown],
      parseQuery('沙丘')
    )
    expect(works).toHaveLength(1)
    expect(unknown.type).toBeUndefined()
  })
  it('明确条件不满足时放到可能相关，确定匹配优先', () => {
    const q = parseQuery('剧集 S02E03 4K')
    expect(
      resourceMatch(
        resource('a', { title: '剧集 S02E03 2160p', workTitle: '剧集' }),
        q
      ).possible
    ).toBe(false)
    expect(
      resourceMatch(
        resource('a', { title: '剧集 S01E03 1080p', workTitle: '剧集' }),
        q
      ).possible
    ).toBe(true)
    expect(resourceMatch(resource('a'), parseQuery('沙丘 1984')).possible).toBe(
      true
    )
  })
  it('补查最多两个可信名称，不把无元数据的资源标题当别名', () => {
    expect(
      searchAliases(
        [
          resource('a', {
            tmdbId: '1',
            aliases: ['Dune', '沙丘', 'DUNE', '沙丘电影'],
          }),
          resource('b', { workTitle: '不可信' }),
        ],
        '沙丘'
      )
    ).toEqual(['DUNE', '沙丘电影'])
  })
  it('磁力哈希规范化、分享按分享码去重', () => {
    expect(
      externalResource({
        title: 'Dune.2021.2160p',
        kind: 'magnet',
        hash: 'ABC',
        source: '站',
        origin: 'torznab',
        link: 'magnet:?xt=abc',
      })
    ).toMatchObject({ key: 'magnet:abc', year: 2021 })
    expect(
      externalResource({
        title: '沙丘',
        shareCode: 'abc',
        receiveCode: '',
        url: 'https://115.com/s/abc',
        source: '站',
      }).key
    ).toBe('share:abc')
  })
})
describe('搜索会话隔离', () => {
  it('同一资源补入 AI 匹配证据时更新原因，不增加资源数量', () => {
    const changed = vi.fn()
    const session = new SearchSession(changed)
    session.publish([resource('a')])
    session.publish([
      resource('a', { reason: 'AI 理解 · 符合条件', interpreted: true }),
    ])
    session.publish([resource('a')])
    const last = changed.mock.calls.at(-1)![0]
    expect(last).toHaveLength(1)
    expect(last[0]).toMatchObject({
      reason: 'AI 理解 · 符合条件',
      interpreted: true,
    })
  })
  it('取消后丢弃迟到发布、状态和新任务', async () => {
    const changed = vi.fn()
    const session = new SearchSession(changed)
    let finish!: () => void
    const pending = session.run(
      'online',
      '沙丘',
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        })
    )
    session.cancel()
    const calls = changed.mock.calls.length
    session.publish([resource('late')])
    finish()
    await pending
    const job = vi.fn()
    await session.run('local', '新词', job)
    expect(changed).toHaveBeenCalledTimes(calls)
    expect(job).not.toHaveBeenCalled()
  })
  it('相同检索只发一次，失败不阻塞其他来源，可单独重试', async () => {
    const changed = vi.fn()
    const session = new SearchSession(changed)
    const job = vi.fn(async () => {
      throw new Error('超时')
    })
    await Promise.all([
      session.run('online', '沙丘', job),
      session.run('local', '沙丘', async () => {
        session.publish([resource('local', { kind: 'local' })])
      }),
    ])
    await session.run('online', '沙丘', job)
    expect(job).toHaveBeenCalledTimes(1)
    expect(session.states.online.status).toBe('error')
    expect(session.states.local.count).toBe(1)
    await session.run('online', '沙丘', async () => '已恢复', true)
    expect(session.states.online.status).toBe('done')
    expect(session.states.local.count).toBe(1)
  })
})
