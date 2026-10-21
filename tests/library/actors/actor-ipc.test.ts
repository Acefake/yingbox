/**
 * 演员库的 IPC 边界校验、bridge 组装、来源设置合并、gfriends 索引文件持久化、合并规则。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mergeActorSettings } from '../../../src/main/library/actors/actor-settings'
import { createFileGfriendsStore } from '../../../src/main/library/actors/gfriends-file-store'
import {
  type ActorRecord,
  actorNameKey,
  castNames,
  mergeProfile,
} from '../../../src/main/library/actors/actor-rules'
import {
  ACTOR_METHODS,
  DEFAULT_ACTOR_SETTINGS,
  LIBRARY_METHODS,
  createActorsBridge,
  parseRpcParams,
} from '../../../src/shared/library/ipc'

const parse = (method: string, params: unknown): unknown =>
  parseRpcParams(method as never, params)

describe('演员库 IPC 校验', () => {
  it('列表查询补默认值、限制每页条数', () => {
    expect(parse('actors.list', undefined)).toEqual({
      libraryId: undefined,
      search: undefined,
      sort: 'works',
      offset: 0,
      limit: 500,
    })
    expect(
      parse('actors.list', { limit: 5000, search: '  三上 ' })
    ).toMatchObject({
      limit: 1000,
      search: '三上',
    })
    expect(() => parse('actors.list', { sort: 'age' })).toThrow(/sort/)
    expect(() => parse('query', { actorId: 0 })).toThrow(/actorId/)
  })

  it('编辑：字段类型、日期、范围、罩杯、地址、未知字段', () => {
    expect(
      parse('actors.update', {
        actorId: 1,
        values: {
          cup: 'e',
          aliases: [' a ', 'a', ''],
          birthday: null,
          height: 160,
        },
        lockedFields: ['cup', 'cup'],
      })
    ).toEqual({
      actorId: 1,
      values: { cup: 'E', aliases: ['a'], birthday: null, height: 160 },
      lockedFields: ['cup'],
    })
    const bad =
      (values: unknown): (() => unknown) =>
      () =>
        parse('actors.update', { actorId: 1, values, lockedFields: [] })
    expect(bad({ birthday: '1993-02-30' })).toThrow(/birthday/)
    expect(bad({ height: 0 })).toThrow(/height/)
    expect(bad({ cup: 'E1' })).toThrow(/cup/)
    expect(bad({ images: ['ftp://x'] })).toThrow(/images/)
    expect(bad({ name: 'x' })).toThrow(/未知字段/)
    expect(bad({ gender: 'other' })).toThrow(/gender/)
    expect(() =>
      parse('actors.update', { actorId: 1, values: {}, lockedFields: ['name'] })
    ).toThrow()
  })

  it('刷新与设置', () => {
    expect(parse('actors.refresh', {})).toEqual({})
    expect(parse('actors.refresh', { actorIds: [2, 2, 3] })).toEqual({
      actorIds: [2, 3],
    })
    expect(() => parse('actors.refresh', { actorIds: [] })).toThrow()
    expect(parse('actors.setSettings', DEFAULT_ACTOR_SETTINGS)).toEqual(
      DEFAULT_ACTOR_SETTINGS
    )
    expect(() =>
      parse('actors.setSettings', {
        sources: [{ id: 'x', enabled: true }],
        autoLookup: true,
      })
    ).toThrow()
    expect(() =>
      parse('actors.setSettings', {
        sources: [
          { id: 'avbase', enabled: true },
          { id: 'avbase', enabled: false },
        ],
        autoLookup: true,
      })
    ).toThrow(/重复/)
  })

  it('白名单包含全部演员方法；bridge 方法与参数对应', async () => {
    for (const m of ACTOR_METHODS) expect(LIBRARY_METHODS).toContain(m)
    const calls: unknown[] = []
    const bridge = createActorsBridge(async (method, params) => {
      calls.push([method, params])
      return undefined as never
    })
    await bridge.list()
    await bridge.get(3)
    await bridge.refresh()
    await bridge.refresh([1])
    await bridge.cancelRefresh()
    expect(calls).toEqual([
      ['actors.list', {}],
      ['actors.get', { actorId: 3 }],
      ['actors.refresh', {}],
      ['actors.refresh', { actorIds: [1] }],
      ['actors.cancelRefresh', undefined],
    ])
  })
})

describe('演员库规则', () => {
  it('来源设置合并：新来源补在后面、未知丢掉、默认自动查', () => {
    const merged = mergeActorSettings({
      sources: [
        { id: 'wikipedia', enabled: false },
        { id: 'nope' as never, enabled: true },
      ],
    })
    expect(merged.sources[0]).toEqual({ id: 'wikipedia', enabled: false })
    expect(merged.sources).toHaveLength(DEFAULT_ACTOR_SETTINGS.sources.length)
    expect(merged.autoLookup).toBe(true)
  })

  it('名字键与演员表', () => {
    expect(actorNameKey(' Ｍｉａ  Ｋ ')).toBe('mia k')
    expect(castNames(null)).toEqual([])
  })

  it('合并：本次优先、没查到保留旧值、锁定保留、别名并集、头像本次在前', () => {
    const current = {
      id: 1,
      name: 'Mia',
      aliases: ['old'],
      height: 150,
      cup: 'C',
      birthday: '1990-01-01',
      images: ['https://old.jpg'],
      lockedFields: ['cup'],
      fieldSources: { cup: 'user', height: 'minnano' },
      ids: {},
      urls: {},
    } as unknown as ActorRecord
    const merged = mergeProfile(current, {
      name: 'Mia',
      aliases: ['new', 'Mia'],
      height: 160,
      cup: 'E',
      images: ['https://new.jpg'],
      ids: { avbase: '1' },
      urls: {},
      fieldSources: { height: 'avbase', cup: 'avbase', images: 'gfriends' },
    })
    expect(merged.values).toMatchObject({
      aliases: ['old', 'new'],
      height: 160,
      cup: 'C',
      birthday: '1990-01-01',
      images: ['https://new.jpg', 'https://old.jpg'],
    })
    expect(merged.fieldSources).toEqual({
      cup: 'user',
      height: 'avbase',
      images: 'gfriends',
    })
    expect(mergeProfile(current, null).values.height).toBe(150)
  })
})

describe('gfriends 索引文件', () => {
  it('保存后读回；文件损坏时返回 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gfriends-'))
    try {
      const path = join(dir, 'sub', 'gfriends-index.json')
      const store = createFileGfriendsStore(path)
      expect(await store.load()).toBeNull()
      await store.save({
        fetchedAt: 5,
        entries: { 'a.jpg': 'Content/x/a.jpg' },
      })
      expect(await store.load()).toEqual({
        fetchedAt: 5,
        entries: { 'a.jpg': 'Content/x/a.jpg' },
      })
      writeFileSync(path, '{broken')
      expect(await store.load()).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
