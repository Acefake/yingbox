/**
 * 写出层集成测试：真实引擎（内存库、临时目录）+ 假 TMDB。
 * 覆盖写出布局、内容未变跳过、合并保留手改、扫描不循环、自动写出、整理预览冲突、
 * apply + undo 往返（含跨盘模拟）、剧集写出与整理。
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../../src/main/library/engine/service'
import type { MoveOps } from '../../../src/main/library/writer/fs/file-ops'
import { pathLimit } from '../../../src/main/library/writer/organize/organize-planner'
import {
  DEFAULT_WRITER_SETTINGS,
  type LibraryEvent,
  type LibraryInfo,
  type LibraryKind,
  type OrganizeEntry,
  type WriterProgressEvent,
  type WriterSettings,
} from '../../../src/shared/library/ipc'
import { tempTree } from '../engine/helpers'
import { FAKE_TOKEN, FakeTmdb } from '../providers/fake-tmdb'

let tree: ReturnType<typeof tempTree>
let mediaDir: string
beforeEach(() => {
  tree = tempTree()
  mediaDir = mkdtempSync(join(tmpdir(), 'yingbox-media-'))
})
afterEach(() => {
  tree.cleanup()
  rmSync(mediaDir, { recursive: true, force: true })
})

interface Env {
  service: LibraryService
  lib: LibraryInfo
  events: LibraryEvent[]
  /** 按文件名找顶层条目 id。 */
  itemOf: (name: string) => number
  /** 写出并等待完成，返回最后一个进度事件。 */
  write: (itemIds: number[]) => Promise<WriterProgressEvent>
  settings: (patch: (s: WriterSettings) => void) => void
  path: (relative: string) => string
}

async function engine(
  kind: LibraryKind,
  files: Record<string, string>,
  options: {
    moveOps?: MoveOps
    deviceOf?: (path: string) => Promise<number | undefined>
    before?: (service: LibraryService) => void
  } = {}
): Promise<Env> {
  for (const [path, content] of Object.entries(files)) tree.write(path, content)
  const tmdb = new FakeTmdb({ token: FAKE_TOKEN })
  const events: LibraryEvent[] = []
  const service = new LibraryService({
    dbPath: ':memory:',
    watch: false,
    identify: {
      fetch: tmdb.fetch,
      mediaDir,
      env: { tmdbToken: FAKE_TOKEN },
      probeDuration: async () => undefined,
    },
    writer: { moveOps: options.moveOps, deviceOf: options.deviceOf },
  })
  service.subscribe(e => events.push(e))
  await service.start()
  options.before?.(service)
  const lib = await service.addLibrary({ root: tree.root, kind })
  await service.queue.idle()
  const itemOf = (name: string): number => {
    const row = service.db
      .prepare(
        `SELECT COALESCE(gp.id, p.id, i.id) AS top FROM files f
         JOIN file_media fm ON fm.file_id = f.id
         JOIN media_items i ON i.id = fm.item_id
         LEFT JOIN media_items p ON p.id = i.parent_id
         LEFT JOIN media_items gp ON gp.id = p.parent_id
         WHERE f.name = ?`
      )
      .get(name)
    if (!row) throw new Error(`没有文件 ${name}`)
    return Number(row.top)
  }
  const write = async (itemIds: number[]): Promise<WriterProgressEvent> => {
    const { jobId } = service.writer.write(itemIds)
    await service.queue.idle()
    const last = events.filter(
      (e): e is WriterProgressEvent =>
        e.type === 'writer-progress' && e.jobId === jobId
    )
    expect(last.at(-1)?.finished).toBe(true)
    return last.at(-1)!
  }
  const settings = (patch: (s: WriterSettings) => void): void => {
    const s = structuredClone(service.writer.getSettings())
    patch(s)
    service.writer.setSettings(s)
  }
  return {
    service,
    lib,
    events,
    itemOf,
    write,
    settings,
    path: r => join(tree.root, r),
  }
}

const read = (path: string): string => readFileSync(path, 'utf8')
const jobTypes = (events: LibraryEvent[]): string[] =>
  events.flatMap(e =>
    e.type === 'job' && e.state === 'queued' ? [e.jobType] : []
  )

describe('写出 NFO 与图片', () => {
  it('独占文件夹用 poster.jpg / <视频名>.nfo，根目录共用用 <视频名>-poster.jpg；再写一次全部跳过', async () => {
    const env = await engine('movie', {
      '流浪地球 (2019)/流浪地球.2019.mkv': '',
      'Heat.1995.1080p.mkv': '',
      'Dune.2021.mkv': '',
    })
    env.settings(s => (s.artwork.legacyNames = true))
    const ids = [
      '流浪地球.2019.mkv',
      'Heat.1995.1080p.mkv',
      'Dune.2021.mkv',
    ].map(env.itemOf)
    const first = await env.write(ids)
    expect(first).toMatchObject({ failed: 0, skipped: 0 })
    expect(first.written).toBe(first.total)

    const own = readdirSync(env.path('流浪地球 (2019)')).sort()
    expect(own).toEqual(
      expect.arrayContaining([
        '流浪地球.2019.nfo',
        'poster.jpg',
        'folder.jpg',
        'fanart.jpg',
      ])
    )
    expect(read(env.path('流浪地球 (2019)/poster.jpg'))).toMatch(
      /^fake-image:\/t\/p\/w780\//
    )
    const nfo = read(env.path('流浪地球 (2019)/流浪地球.2019.nfo'))
    expect(nfo).toContain(
      '<uniqueid type="tmdb" default="true">535167</uniqueid>'
    )
    expect(nfo).toContain('<title>流浪地球</title>')

    const root = readdirSync(tree.root)
    expect(root).toEqual(
      expect.arrayContaining([
        'Heat.1995.1080p.nfo',
        'Heat.1995.1080p-poster.jpg',
        'Heat.1995.1080p-movie.jpg',
        'Heat.1995.1080p-folder.jpg',
        'Heat.1995.1080p-fanart.jpg',
        'Dune.2021.nfo',
      ])
    )
    expect(root).not.toContain('poster.jpg')
    expect(root.some(n => n.includes('.yb-'))).toBe(false)
    const written = env.service.db
      .prepare(
        'SELECT COUNT(*) AS n FROM media_items WHERE written_at IS NOT NULL'
      )
      .get()!
    expect(Number(written.n)).toBe(3)

    const second = await env.write(ids)
    expect(second).toMatchObject({
      written: 0,
      failed: 0,
      skipped: first.total,
    })
    await env.service.close()
  })

  it('合并模式保留手改字段；覆盖模式重写；合并模式不覆盖用户自己的海报', async () => {
    const env = await engine('movie', {
      '流浪地球 (2019)/流浪地球.2019.mkv': '',
    })
    const id = env.itemOf('流浪地球.2019.mkv')
    const nfoPath = env.path('流浪地球 (2019)/流浪地球.2019.nfo')
    writeFileSync(env.path('流浪地球 (2019)/poster.jpg'), 'my own poster')
    await env.write([id])
    expect(read(env.path('流浪地球 (2019)/poster.jpg'))).toBe('my own poster')
    writeFileSync(
      nfoPath,
      read(nfoPath).replace(
        '<title>流浪地球</title>',
        '<title>我改的名字</title>'
      )
    )

    const merged = await env.write([id])
    expect(merged.written).toBe(0)
    expect(read(nfoPath)).toContain('<title>我改的名字</title>')

    env.settings(s => (s.nfo.mode = 'overwrite'))
    await env.write([id])
    expect(read(nfoPath)).toContain('<title>流浪地球</title>')
    expect(read(env.path('流浪地球 (2019)/poster.jpg'))).toMatch(/^fake-image:/)
    await env.service.close()
  })

  it('扫描不会因为自己写的 sidecar 循环：重扫没有条目变化、不排识别、不再写出', async () => {
    const env = await engine('movie', {
      '流浪地球 (2019)/流浪地球.2019.mkv': '',
    })
    env.settings(s => (s.autoWriteAfterIdentify = true))
    await env.write([env.itemOf('流浪地球.2019.mkv')])
    env.events.length = 0
    env.service.scan({ libraryId: env.lib.id, full: true })
    await env.service.queue.idle()
    expect(env.events.filter(e => e.type === 'items-changed')).toEqual([])
    expect(jobTypes(env.events)).not.toContain('identify')
    expect(jobTypes(env.events)).not.toContain('writer-write')
    // 写出的文件已被扫描收录为 nfo / 图片，但不关联任何条目
    const sidecars = env.service.db
      .prepare("SELECT COUNT(*) AS n FROM files WHERE kind IN ('nfo', 'image')")
      .get()!
    expect(Number(sidecars.n)).toBeGreaterThan(0)
    await env.service.close()
  })

  it('识别后自动写出（开启时）', async () => {
    const env = await engine(
      'movie',
      { '流浪地球 (2019)/流浪地球.2019.mkv': '' },
      {
        before: service => {
          service.writer.setSettings({
            ...DEFAULT_WRITER_SETTINGS,
            autoWriteAfterIdentify: true,
          })
        },
      }
    )
    expect(existsSync(env.path('流浪地球 (2019)/流浪地球.2019.nfo'))).toBe(true)
    expect(jobTypes(env.events)).toContain('writer-write')
    await env.service.close()
  })

  it('剧集：tvshow.nfo、季海报、season.nfo、每集 nfo 与缩略图', async () => {
    const env = await engine('tv', {
      '请回答1988/Season 1/请回答1988.S01E02.mkv': '',
    })
    await env.write([env.itemOf('请回答1988.S01E02.mkv')])
    const show = readdirSync(env.path('请回答1988'))
    expect(show).toEqual(expect.arrayContaining(['tvshow.nfo', 'Season 1']))
    expect(read(env.path('请回答1988/tvshow.nfo'))).toContain(
      '<uniqueid type="tmdb" default="true">64010</uniqueid>'
    )
    const season = readdirSync(env.path('请回答1988/Season 1'))
    expect(season).toEqual(
      expect.arrayContaining(['season.nfo', '请回答1988.S01E02.nfo'])
    )
    const episode = read(env.path('请回答1988/Season 1/请回答1988.S01E02.nfo'))
    expect(episode).toMatch(
      /<episodedetails>[\s\S]*<season>1<\/season>[\s\S]*<episode>2<\/episode>/
    )
    await env.service.close()
  })
})

describe('整理（改名移动）', () => {
  const movieFiles = {
    'Heat.1995.1080p.mkv': 'heat',
    'Heat.1995.1080p.zh.srt': 'sub',
    '流浪地球 (2019)/流浪地球.2019.mkv': 'earth',
    '流浪地球 (2019)/poster.jpg': 'p',
    'Dune.2021.mkv': 'dune',
  }

  it('默认关闭：预览可用、执行被拒绝；预览报告冲突，旁挂随视频一起被阻止', async () => {
    const env = await engine('movie', movieFiles)
    const ids = [
      'Heat.1995.1080p.mkv',
      '流浪地球.2019.mkv',
      'Dune.2021.mkv',
    ].map(env.itemOf)
    tree.write('沙丘 (2021)/沙丘 (2021).mkv', 'someone else')
    const plan = await env.service.writer.previewOrganize(ids)
    const by = (from: string): OrganizeEntry | undefined =>
      plan.entries.find(e => e.from === env.path(from))

    expect(by('Heat.1995.1080p.mkv')).toMatchObject({
      kind: 'video',
      to: env.path('盗火线 (1995)/盗火线 (1995).mkv'),
      crossDevice: false,
    })
    expect(by('Heat.1995.1080p.mkv')!.conflict).toBeUndefined()
    expect(by('Heat.1995.1080p.zh.srt')).toMatchObject({
      kind: 'sidecar',
      to: env.path('盗火线 (1995)/盗火线 (1995).zh.srt'),
    })
    expect(by('流浪地球 (2019)/流浪地球.2019.mkv')!.to).toBe(
      env.path('流浪地球 (2019)/流浪地球 (2019).mkv')
    )
    // 同目录改名：poster.jpg 不动
    expect(by('流浪地球 (2019)/poster.jpg')).toBeUndefined()
    expect(by('Dune.2021.mkv')!.conflict).toBe('目标已存在')

    expect(() => env.service.writer.applyOrganize(plan.planId)).toThrow(
      /未开启/
    )
    await env.service.close()
  })

  it('apply → 文件、数据库路径与匹配都跟着走，重扫不产生新条目；undo → 全部回到原处', async () => {
    const env = await engine('movie', movieFiles)
    env.settings(s => (s.organize.enabled = true))
    const heat = env.itemOf('Heat.1995.1080p.mkv')
    const earth = env.itemOf('流浪地球.2019.mkv')
    await env.write([heat])
    const before = env.service.getItem({ itemId: heat })!
    const countItems = (): number =>
      Number(
        env.service.db.prepare('SELECT COUNT(*) AS n FROM media_items').get()!.n
      )
    const itemsBefore = countItems()

    const plan = await env.service.writer.previewOrganize([heat, earth])
    expect(plan.entries.every(e => !e.conflict)).toBe(true)
    const { batchId } = env.service.writer.applyOrganize(plan.planId)
    await env.service.queue.idle()

    expect(readdirSync(env.path('盗火线 (1995)')).sort()).toEqual([
      '盗火线 (1995)-clearlogo.png',
      '盗火线 (1995)-fanart.jpg',
      '盗火线 (1995)-poster.jpg',
      '盗火线 (1995).mkv',
      '盗火线 (1995).nfo',
      '盗火线 (1995).zh.srt',
    ])
    expect(existsSync(env.path('Heat.1995.1080p.mkv'))).toBe(false)
    expect(existsSync(env.path('流浪地球 (2019)/流浪地球 (2019).mkv'))).toBe(
      true
    )
    const after = env.service.getItem({ itemId: heat })!
    expect(after.files.map(f => f.path)).toEqual([
      env.path('盗火线 (1995)/盗火线 (1995).mkv'),
    ])
    expect(after).toMatchObject({
      providerIds: before.providerIds,
      matchState: 'auto',
    })
    expect(env.service.writer.listOrganizeBatches()[0]).toMatchObject({
      batchId,
      state: 'done',
      failed: 0,
    })

    env.events.length = 0
    env.service.scan({ libraryId: env.lib.id, full: true })
    await env.service.queue.idle()
    expect(countItems()).toBe(itemsBefore)
    expect(jobTypes(env.events)).not.toContain('identify')
    expect(env.service.getItem({ itemId: heat })!.files[0].path).toBe(
      env.path('盗火线 (1995)/盗火线 (1995).mkv')
    )

    env.service.writer.undoOrganize(batchId)
    await env.service.queue.idle()
    expect(read(env.path('Heat.1995.1080p.mkv'))).toBe('heat')
    expect(read(env.path('Heat.1995.1080p.zh.srt'))).toBe('sub')
    expect(existsSync(env.path('Heat.1995.1080p-poster.jpg'))).toBe(true)
    expect(existsSync(env.path('盗火线 (1995)'))).toBe(false)
    expect(existsSync(env.path('流浪地球 (2019)/流浪地球.2019.mkv'))).toBe(true)
    expect(env.service.getItem({ itemId: heat })!.files[0].path).toBe(
      env.path('Heat.1995.1080p.mkv')
    )
    expect(env.service.writer.listOrganizeBatches()[0]).toMatchObject({
      batchId,
      state: 'undone',
    })
    expect(() => env.service.writer.undoOrganize(batchId)).toThrow(/不能撤销/)
    await env.service.close()
  })

  it('同一部电影多个文件：按 - part1 / - part2 区分，不互相冲突', async () => {
    const env = await engine('movie', {
      'Heat.1995.CD1.mkv': 'a',
      'Heat.1995.CD2.mkv': 'b',
    })
    const plan = await env.service.writer.previewOrganize([
      env.itemOf('Heat.1995.CD1.mkv'),
    ])
    expect(plan.entries.map(e => [e.to, e.conflict])).toEqual([
      [env.path('盗火线 (1995)/盗火线 (1995) - part1.mkv'), undefined],
      [env.path('盗火线 (1995)/盗火线 (1995) - part2.mkv'), undefined],
    ])
    expect(pathLimit('C:\\Media')).toBe(259)
    expect(pathLimit('\\\\nas\\share')).toBe(259)
    await env.service.close()
  })

  it('跨盘：预览标出 crossDevice，执行走复制 + 校验 + 删除，撤销同样可回滚', async () => {
    const exdev = (): Promise<void> =>
      Promise.reject(
        Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
      )
    const env = await engine(
      'movie',
      { 'Heat.1995.1080p.mkv': 'heat-bytes', 'Heat.1995.1080p.zh.srt': 'sub' },
      {
        moveOps: { rename: exdev },
        deviceOf: async path => (path.includes('盗火线') ? 2 : 1),
      }
    )
    env.settings(s => (s.organize.enabled = true))
    const heat = env.itemOf('Heat.1995.1080p.mkv')
    const plan = await env.service.writer.previewOrganize([heat])
    expect(plan.entries.length).toBe(2)
    expect(plan.entries.every(e => e.crossDevice)).toBe(true)
    const { batchId } = env.service.writer.applyOrganize(plan.planId)
    await env.service.queue.idle()
    expect(read(env.path('盗火线 (1995)/盗火线 (1995).mkv'))).toBe('heat-bytes')
    expect(existsSync(env.path('Heat.1995.1080p.mkv'))).toBe(false)
    env.service.writer.undoOrganize(batchId)
    await env.service.queue.idle()
    expect(read(env.path('Heat.1995.1080p.mkv'))).toBe('heat-bytes')
    expect(existsSync(env.path('盗火线 (1995)'))).toBe(false)
    await env.service.close()
  })

  it('剧集：按模板改名，剧集级与季级文件随文件夹走', async () => {
    const env = await engine('tv', {
      '请回答1988/Season 1/请回答1988.S01E02.mkv': 'e2',
      '请回答1988/Season 1/请回答1988.S01E02.chs.ass': 'sub',
    })
    env.settings(s => (s.organize.enabled = true))
    const id = env.itemOf('请回答1988.S01E02.mkv')
    await env.write([id])
    mkdirSync(env.path('请回答1988/.actors'))
    writeFileSync(env.path('请回答1988/.actors/a.jpg'), 'a')
    const plan = await env.service.writer.previewOrganize([id])
    expect(plan.entries.filter(e => e.conflict)).toEqual([])
    const video = plan.entries.find(e => e.kind === 'video')!
    const showDir = dirname(dirname(video.to))
    expect(video.to).toMatch(
      /请回答1988 \(2015\)[\\/]Season 01[\\/]请回答1988 - S01E02( - .+)?\.mkv$/
    )
    env.service.writer.applyOrganize(plan.planId)
    await env.service.queue.idle()
    const show = readdirSync(showDir)
    expect(show).toEqual(
      expect.arrayContaining(['tvshow.nfo', 'Season 01', '.actors'])
    )
    expect(readdirSync(join(showDir, 'Season 01'))).toEqual(
      expect.arrayContaining(['season.nfo'])
    )
    expect(
      readdirSync(join(showDir, 'Season 01')).some(n => n.endsWith('.chs.ass'))
    ).toBe(true)
    expect(existsSync(env.path('请回答1988'))).toBe(false)
    await env.service.close()
  })
})
