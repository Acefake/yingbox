/**
 * 番号页「类型」筛选：jav_kind(code) 按番号判类别（与刮削选站同一规则），
 * 查询参数 javKinds 校验，以及海报墙查询按类别过滤（未识别的条目没有类别）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeLibraryQuery } from '../../../src/shared/library/ipc'
import { javKindOf } from '../../../src/main/library/catalog/jav-kind'
import { LibraryService } from '../../../src/main/library/engine/service'
import { tempTree } from './helpers'

describe('javKindOf', () => {
  it('有码 / 无码 / FC2 / 素人；认不出为 null', () => {
    expect(javKindOf('SSIS-497')).toBe('censored')
    expect(javKindOf('HEYZO-0841')).toBe('uncensored')
    expect(javKindOf('FC2-PPV-1234567')).toBe('fc2')
    expect(javKindOf('259LUXU-1234')).toBe('amateur')
    expect(javKindOf('550')).toBeNull()
  })
})

describe('normalizeLibraryQuery 的 javKinds', () => {
  it('缺省不限；合法值保留；其它值拒绝', () => {
    expect(normalizeLibraryQuery({}).javKinds).toBeUndefined()
    expect(normalizeLibraryQuery({ javKinds: ['fc2'] }).javKinds).toEqual([
      'fc2',
    ])
    expect(() => normalizeLibraryQuery({ javKinds: ['vr'] })).toThrow(
      expect.objectContaining({ code: 'invalid-params' })
    )
  })
})

describe('按类别查询（真实服务）', () => {
  let jav: ReturnType<typeof tempTree>
  let service: LibraryService

  beforeEach(async () => {
    jav = tempTree()
    service = new LibraryService({ dbPath: ':memory:', watch: false })
    await service.start()
  })
  afterEach(async () => {
    await service.close()
    jav.cleanup()
  })

  it('只返回该类别的已识别条目', async () => {
    for (const code of ['SSIS-497', 'HEYZO-0841', 'FC2-PPV-1234567', 'ABP-123'])
      jav.write(`${code}.mp4`)
    const off = { identify: false, watch: false }
    await service.addLibrary({
      root: jav.root,
      kind: 'movie',
      source: 'jav',
      automation: off,
    })
    await service.queue.idle()
    // 模拟识别结果：番号库条目的番号存在 tmdb_id；ABP-123 当作还没识别
    service.db.exec(
      "UPDATE media_items SET tmdb_id = upper(title) WHERE upper(title) <> 'ABP-123'"
    )
    const codes = async (javKinds?: string[]): Promise<string[]> =>
      service
        .query(
          normalizeLibraryQuery({
            source: 'jav',
            types: ['movie'],
            sort: 'title',
            ...(javKinds ? { javKinds } : {}),
          })
        )
        .items.map(i => i.title.toUpperCase())
    expect(await codes()).toHaveLength(4)
    expect(await codes(['censored'])).toEqual(['SSIS-497'])
    expect(await codes(['uncensored', 'fc2'])).toEqual([
      'FC2-PPV-1234567',
      'HEYZO-0841',
    ])
    expect(await codes(['amateur'])).toEqual([])
  })
})
