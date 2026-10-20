import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { normalizeLibraryQuery } from '../../../src/shared/library/ipc'
import { ageTree, count, scanEnv, tempTree } from './helpers'

let tree: ReturnType<typeof tempTree>
beforeEach(() => {
  tree = tempTree()
})
afterEach(() => tree.cleanup())

const allQuery = normalizeLibraryQuery({})

describe('scanLibrary：电影库', () => {
  it('冷扫写入目录、文件、解析结果和条目', async () => {
    tree.write('Inception (2010)/Inception (2010).mkv', 'a')
    tree.write('Inception (2010)/movie.nfo')
    tree.write('Inception (2010)/poster.jpg')
    tree.write('流浪地球 The Wandering Earth 2019/流浪地球.2019.1080p.mkv', 'b')
    tree.write('notes.txt')
    const env = scanEnv(tree.root)

    const summary = await env.scan()

    expect(summary.added).toBe(4)
    expect(count(env.db, 'SELECT COUNT(*) FROM dirs')).toBe(3)
    const parsed = env.db
      .prepare("SELECT parsed FROM files WHERE kind = 'video' ORDER BY name")
      .all()
      .map(r => JSON.parse(String(r.parsed)))
    expect(parsed.map(p => [p.type, p.title, p.year])).toEqual([
      ['movie', 'Inception', 2010],
      ['movie', '流浪地球', 2019],
    ])
    const { items, total } = env.query.list(allQuery)
    expect(total).toBe(2)
    expect(items.map(i => [i.type, i.title, i.year, i.matchState])).toEqual([
      ['movie', 'Inception', 2010, 'unmatched'],
      ['movie', '流浪地球', 2019, 'unmatched'],
    ])
    expect(summary.changes.added.size).toBe(2)
  })

  it('无变化重扫：不 readdir 已知目录、不写库、不产生条目变化', async () => {
    tree.write('A (2001)/A (2001).mkv')
    tree.write('B (2002)/B (2002).mkv')
    ageTree(tree.root)
    const env = scanEnv(tree.root)
    await env.scan()
    const before = env.db.prepare('SELECT * FROM files ORDER BY id').all()

    const again = await env.scan()

    expect(again.added + again.changed + again.removed).toBe(0)
    expect(again.stats.dirsReused).toBe(2)
    expect(again.stats.filesStatted).toBe(0)
    expect(again.changes.empty).toBe(true)
    expect(env.db.prepare('SELECT * FROM files ORDER BY id').all()).toEqual(
      before
    )
  })

  it('孙子层增删可见（父目录 mtime 不变）', async () => {
    const victim = tree.write('Show/Season 1/Show S01E01.mkv')
    tree.write('Show/Season 1/Show S01E02.mkv')
    ageTree(tree.root)
    const env = scanEnv(tree.root, 'tv')
    await env.scan()

    rmSync(victim)
    tree.write('Show/Season 1/Show S01E03.mkv')
    const summary = await env.scan()

    expect(summary.added).toBe(1)
    expect(summary.removed).toBe(1)
    expect(summary.stats.dirsReused).toBe(1) // Show 自身没变，只是被下钻
    const names = env.db
      .prepare('SELECT name FROM files ORDER BY name')
      .all()
      .map(r => r.name)
    expect(names).toEqual(['Show S01E02.mkv', 'Show S01E03.mkv'])
  })

  it('删除目录：整棵子树出库，空条目被回收', async () => {
    tree.write('Keep (2000)/Keep (2000).mkv')
    tree.write('Gone (2001)/Gone (2001).mkv')
    tree.write('Gone (2001)/Extras/Gone - Trailer.mkv')
    const env = scanEnv(tree.root)
    await env.scan()
    const goneId = env.query
      .list(allQuery)
      .items.find(i => i.title === 'Gone')!.id

    rmSync(join(tree.root, 'Gone (2001)'), { recursive: true })
    const summary = await env.scan()

    expect(summary.removed).toBe(2)
    expect(
      count(env.db, "SELECT COUNT(*) FROM dirs WHERE path LIKE '%Gone%'")
    ).toBe(0)
    expect(env.query.list(allQuery).items.map(i => i.title)).toEqual(['Keep'])
    expect([...summary.changes.removed]).toEqual([goneId])
  })

  it('文件内容变化（大小不同）重新解析并保留 id', async () => {
    const file = tree.write('X (1999)/X (1999).mkv', 'a')
    const env = scanEnv(tree.root)
    await env.scan()
    const id = count(env.db, 'SELECT id FROM files')

    writeFileSync(file, 'longer content')
    const summary = await env.scan({ full: true })

    expect(summary.changed).toBe(1)
    expect(count(env.db, 'SELECT id FROM files')).toBe(id)
    expect(count(env.db, 'SELECT size FROM files')).toBe(14)
  })

  it('扫描时刚改过的目录不信任 mtime，下次强制重读（同一时间片内的改动不会漏）', async () => {
    tree.write('A (2001)/A (2001).mkv')
    const env = scanEnv(tree.root)
    await env.scan()
    expect(
      count(env.db, "SELECT mtime FROM dirs WHERE path LIKE '%A (2001)'")
    ).toBe(-1)

    tree.write('A (2001)/A (2001) - Directors Cut.mkv')
    const summary = await env.scan()

    expect(summary.added).toBe(1)
  })

  it('根目录不存在时抛错且不删除任何记录', async () => {
    tree.write('A (2001)/A (2001).mkv')
    const env = scanEnv(tree.root)
    await env.scan()
    tree.cleanup()

    await expect(env.scan()).rejects.toThrow()
    expect(count(env.db, 'SELECT COUNT(*) FROM files')).toBe(1)
  })

  it('scope 只重读指定目录，并完整下钻新出现的子目录', async () => {
    tree.write('A (2001)/A (2001).mkv')
    const env = scanEnv(tree.root)
    await env.scan()

    tree.write('A (2001)/Featurettes/Making Of.mkv')
    tree.write('B (2002)/B (2002).mkv')
    const summary = await env.scan({ scope: [join(tree.root, 'A (2001)')] })

    // 只读了 A：发现新子目录 Featurettes；B 不在范围内
    expect(summary.added).toBe(1)
    expect(
      count(env.db, "SELECT COUNT(*) FROM files WHERE name = 'B (2002).mkv'")
    ).toBe(0)
    expect(
      count(env.db, "SELECT COUNT(*) FROM files WHERE name = 'Making Of.mkv'")
    ).toBe(1)
  })

  it('中断后重扫收敛到同一结果（批次提交，幂等）', async () => {
    for (let i = 0; i < 30; i++) tree.write(`M${i} (2000)/M${i} (2000).mkv`)
    const env = scanEnv(tree.root)
    const controller = new AbortController()
    let batches = 0
    await expect(
      env.scan({
        batchSize: 5,
        signal: controller.signal,
        onProgress: () => {
          if (++batches === 2) controller.abort(new Error('中断'))
        },
      })
    ).rejects.toThrow('中断')
    const partial = count(env.db, 'SELECT COUNT(*) FROM files')
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(30)

    const resumed = await env.scan()

    expect(resumed.added).toBe(30 - partial)
    expect(count(env.db, 'SELECT COUNT(*) FROM files')).toBe(30)
    expect(env.query.list(allQuery).total).toBe(30)
  })
})

describe('scanLibrary：剧集库', () => {
  it('按根下第一层文件夹分组为 剧集 → 季 → 集，多集文件关联多集', async () => {
    tree.write('Breaking Bad/Season 1/Breaking.Bad.S01E01.mkv')
    tree.write('Breaking Bad/Season 1/breaking bad s01e02-e03.mkv')
    tree.write('Breaking Bad/Season 2/BB S02E01.mkv')
    const env = scanEnv(tree.root, 'tv')
    await env.scan()

    const { items } = env.query.list(allQuery)
    expect(items).toHaveLength(1)
    const series = env.query.getItem(items[0].id)!
    expect(series.type).toBe('series')
    expect(series.children.map(s => s.seasonNumber)).toEqual([1, 2])
    expect(series.children[0].children.map(e => e.episodeNumber)).toEqual([
      1, 2, 3,
    ])
    const [, e2, e3] = series.children[0].children
    expect(e2.files[0].id).toBe(e3.files[0].id)
  })

  it('删掉一季的全部文件后，季条目被回收、剧集保留', async () => {
    tree.write('Show/Season 1/Show S01E01.mkv')
    tree.write('Show/Season 2/Show S02E01.mkv')
    const env = scanEnv(tree.root, 'tv')
    await env.scan()

    rmSync(join(tree.root, 'Show/Season 2'), { recursive: true })
    await env.scan()

    const id = env.query.list(allQuery).items[0].id
    expect(env.query.getItem(id)!.children.map(s => s.seasonNumber)).toEqual([
      1,
    ])
  })
})

describe('scanLibrary：移动识别', () => {
  it('目录改名：保留文件 id 与条目关联，不当成新文件', async () => {
    tree.write('Heat/Heat.mkv', 'x'.repeat(1000))
    const env = scanEnv(tree.root)
    await env.scan()
    const fileId = count(env.db, 'SELECT id FROM files')
    const itemId = env.query.list(allQuery).items[0].id

    renameSync(join(tree.root, 'Heat'), join(tree.root, 'Heat (1995)'))
    const summary = await env.scan()

    expect(summary.moved).toHaveLength(1)
    expect(summary.moved[0].by).toBe('name')
    expect(summary.added + summary.removed).toBe(0)
    const row = env.db.prepare('SELECT id, display_path FROM files').get()!
    expect(Number(row.id)).toBe(fileId)
    expect(String(row.display_path)).toContain('Heat (1995)')
    expect(count(env.db, 'SELECT item_id FROM file_media')).toBe(itemId)
  })

  it('有指纹时按 hash 配对：改名 + 换目录也能认出', async () => {
    const content = Buffer.alloc(200_000, 7)
    tree.write('Old Name (2000)/old.name.2000.mkv', content)
    tree.write('Other (2001)/Other (2001).mkv', Buffer.alloc(200_000, 9))
    const env = scanEnv(tree.root)
    await env.scan()
    const rows = env.db.prepare('SELECT id, display_path FROM files').all()
    for (const r of rows) {
      const { fingerprintFile } =
        await import('../../../src/main/library/scanner/fingerprint')
      env.scanStore.setFingerprint(
        Number(r.id),
        (await fingerprintFile(String(r.display_path)))!
      )
    }
    const oldId = Number(
      rows.find(r => String(r.display_path).includes('old.name'))!.id
    )

    mkdirSync(join(tree.root, 'Archive'))
    renameSync(
      join(tree.root, 'Old Name (2000)/old.name.2000.mkv'),
      join(tree.root, 'Archive/Completely Different.mkv')
    )
    const summary = await env.scan()

    expect(summary.moved.map(m => [m.from.id, m.by])).toEqual([
      [oldId, 'fingerprint'],
    ])
    expect(summary.added).toBe(0)
    expect(count(env.db, 'SELECT COUNT(*) FROM files')).toBe(2)
  })

  it('没有同大小的删除时不读文件算指纹', async () => {
    tree.write('A (2001)/A (2001).mkv', 'aaa')
    const env = scanEnv(tree.root)
    await env.scan()
    tree.write('B (2002)/B (2002).mkv', 'bbbbbb')
    await env.scan()
    expect(env.fingerprintCalls()).toBe(0)
  })
})
