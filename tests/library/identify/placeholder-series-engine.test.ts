/**
 * 占位剧条目 + 真实引擎（内存库、假 TMDB）：剧名匹配、指定 id、候选、幂等，以及不上海报墙。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { handleRpc } from '../../../src/main/library/engine/rpc'
import { LibraryService } from '../../../src/main/library/engine/service'
import { tempTree } from '../engine/helpers'
import { FAKE_TOKEN, FakeTmdb } from '../providers/fake-tmdb'

let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

async function setup(): Promise<{
  ensure: (params: unknown) => Promise<unknown>
  service: LibraryService
}> {
  const tree = tempTree()
  const tmdb = new FakeTmdb({ token: FAKE_TOKEN })
  const service = new LibraryService({
    dbPath: ':memory:',
    watch: false,
    identify: { fetch: tmdb.fetch, env: { tmdbToken: FAKE_TOKEN } },
  })
  await service.start()
  await service.addLibrary({ root: tree.root, kind: 'tv' })
  await service.queue.idle()
  cleanup = () => {
    void service.close()
    tree.cleanup()
  }
  const ensure = async (params: unknown): Promise<unknown> => {
    const out = await handleRpc(service, {
      method: 'calendar.ensureSeries',
      params,
    })
    if (!out.ok) throw new Error(JSON.stringify(out))
    return out.result
  }
  return { ensure, service }
}

describe('calendar.ensureSeries（真实引擎）', () => {
  it('按剧名建占位剧条目：锁定匹配、没有文件、不上墙；再追是同一条', async () => {
    const { ensure, service } = await setup()
    const first = (await ensure({ title: '绝命毒师', year: 2008 })) as {
      status: string
      itemId: number
      created: boolean
    }
    expect(first).toMatchObject({ status: 'ready', created: true })
    const row = service.db
      .prepare('SELECT * FROM media_items WHERE id = ?')
      .get(first.itemId)!
    expect(row).toMatchObject({
      type: 'series',
      tmdb_id: '1396',
      match_state: 'locked',
      local_key: 'placeholder:tmdb:1396',
    })
    expect(
      service.db.prepare('SELECT COUNT(*) AS n FROM file_media').get()
    ).toMatchObject({ n: 0 })

    const again = await ensure({ title: '绝命毒师' })
    expect(again).toEqual({
      status: 'ready',
      itemId: first.itemId,
      created: false,
    })
    expect(
      service.db.prepare('SELECT COUNT(*) AS n FROM media_items').get()
    ).toMatchObject({ n: 1 })

    const wall = await handleRpc(service, {
      method: 'query',
      params: { types: ['series'] },
    })
    expect(wall.ok && (wall.result as { total: number }).total).toBe(0)
  })

  it('指定 tmdbId 直接建；TMDB 上没有这个剧名时不留任何行', async () => {
    const { ensure, service } = await setup()
    expect(await ensure({ title: '随便', tmdbId: '64010' })).toMatchObject({
      status: 'ready',
      created: true,
    })
    const none = (await ensure({ title: '完全不存在的剧集名字xyz' })) as {
      status: string
    }
    expect(['none', 'choose']).toContain(none.status)
    expect(
      service.db.prepare('SELECT COUNT(*) AS n FROM media_items').get()
    ).toMatchObject({ n: 1 })
  })
})
