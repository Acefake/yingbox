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
import { handleRpc } from '../../../src/main/library/engine/rpc'
import { LibraryService } from '../../../src/main/library/engine/service'
import type { MoveOps } from '../../../src/main/library/writer/fs/file-ops'
import { pathLimit } from '../../../src/main/library/writer/organize/organize-planner'
import { WriterStore } from '../../../src/main/library/writer/writer-store'
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

it('番号整理使用独立模板和开关，批次不会出现在普通媒体库设置里', async () => {
  const env = await engine('movie', { 'Heat.1995.mkv': 'video' })
  try {
    env.service.db
      .prepare("UPDATE libraries SET source = 'jav' WHERE id = ?")
      .run(env.lib.id)
    const jav = env.service.writer.getJavSettings()
    jav.organize.enabled = true
    jav.organize.movieTemplate = 'jav/{title}.{ext}'
    env.service.writer.setJavSettings(jav)
    expect(env.service.writer.getSettings().organize.enabled).toBe(false)
    const plan = await env.service.writer.previewOrganize([
      env.itemOf('Heat.1995.mkv'),
    ])
    expect(plan.entries.find(entry => entry.kind === 'video')?.to).toBe(
      env.path('jav/盗火线.mkv')
    )
    const { batchId } = env.service.writer.applyOrganize(plan.planId)
    await env.service.queue.idle()
    expect(existsSync(env.path('jav/盗火线.mkv'))).toBe(true)
    expect(env.service.writer.listOrganizeBatches()).toEqual([])
    expect(
      env.service.writer.listOrganizeBatches('jav').map(batch => batch.batchId)
    ).toContain(batchId)
  } finally {
    await env.service.close()
  }
})

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
  it('图片尺寸按刮削偏好（宿主下发的 setScrapePrefs）：海报原图、背景标准', async () => {
    const env = await engine('movie', {
      '流浪地球 (2019)/流浪地球.2019.mkv': '',
    })
    const reply = await handleRpc(env.service, {
      method: 'setScrapePrefs',
      params: {
        language: 'zh-CN',
        imageSize: { poster: 'original', backdrop: 'w342', actor: 'w780' },
      },
    })
    expect(reply).toMatchObject({ ok: true })
    await env.write([env.itemOf('流浪地球.2019.mkv')])
    expect(read(env.path('流浪地球 (2019)/poster.jpg'))).toMatch(
      /^fake-image:\/t\/p\/original\//
    )
    expect(read(env.path('流浪地球 (2019)/fanart.jpg'))).toMatch(
      /^fake-image:\/t\/p\/w780\//
    )
  })

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

  it('剧在分类文件夹下：tvshow.nfo 和海报写进剧文件夹，不写进分类文件夹', async () => {
    const env = await engine('tv', {
      '剧集/大陆/请回答1988 (2015)/Season 01/请回答1988.S01E02.mkv': '',
    })
    await env.write([env.itemOf('请回答1988.S01E02.mkv')])
    const show = env.path('剧集/大陆/请回答1988 (2015)')
    expect(readdirSync(show)).toEqual(
      expect.arrayContaining(['tvshow.nfo', 'Season 01'])
    )
    expect(existsSync(join(show, 'Season 01', 'season.nfo'))).toBe(true)
    expect(existsSync(env.path('剧集/tvshow.nfo'))).toBe(false)
    expect(existsSync(env.path('剧集/大陆/tvshow.nfo'))).toBe(false)
    await env.service.close()
  })

  it('集直接散放在分类文件夹里：不写剧集级文件，每集照常写', async () => {
    const env = await engine('tv', { '剧集/大陆/请回答1988.S01E02.mkv': '' })
    await env.write([env.itemOf('请回答1988.S01E02.mkv')])
    expect(existsSync(env.path('剧集/大陆/tvshow.nfo'))).toBe(false)
    expect(existsSync(env.path('剧集/tvshow.nfo'))).toBe(false)
    expect(existsSync(env.path('剧集/大陆/请回答1988.S01E02.nfo'))).toBe(true)
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
    const outputs = new WriterStore(env.service.db)
    const oldPoster = env.path('Heat.1995.1080p-poster.jpg')
    const newPoster = env.path('盗火线 (1995)/盗火线 (1995)-poster.jpg')
    const outputBefore = outputs.output(oldPoster)
    expect(outputBefore).toBeDefined()
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
    expect(outputs.output(oldPoster)).toBeUndefined()
    expect(outputs.output(newPoster)).toMatchObject({
      hash: outputBefore!.hash,
      fields: outputBefore!.fields,
    })
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
    expect(outputs.output(newPoster)).toBeUndefined()
    expect(outputs.output(oldPoster)).toMatchObject({
      hash: outputBefore!.hash,
    })
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

  it('电影散放在分类文件夹里：新文件夹建在分类里，分类里的其他文件不跟着走；两个版本不当分段', async () => {
    const env = await engine('movie', {
      '电影/Heat.1995.2160p.BluRay.REMUX.mkv': 'remux',
      '电影/Heat.1995.1080p.WEB-DL.mkv': 'web',
      '电影/folder.jpg': 'category art',
    })
    const plan = await env.service.writer.previewOrganize([
      env.itemOf('Heat.1995.2160p.BluRay.REMUX.mkv'),
    ])
    expect(plan.entries.map(e => [e.to, e.conflict]).sort()).toEqual(
      [
        [
          env.path('电影/盗火线 (1995)/盗火线 (1995) - 1080p WEB-DL.mkv'),
          undefined,
        ],
        [
          env.path('电影/盗火线 (1995)/盗火线 (1995) - 2160p REMUX.mkv'),
          undefined,
        ],
      ].sort()
    )
    expect(plan.entries.some(e => e.from === env.path('电影/folder.jpg'))).toBe(
      false
    )
    await env.service.close()
  })

  it('电影的广告小视频直接删，旧文件夹清空后删掉；撤销时视频回来、广告不恢复', async () => {
    const env = await engine('movie', {
      '电影/Heat.1995.1080p/Heat.1995.1080p.mkv': 'x'.repeat(10_000),
      '电影/Heat.1995.1080p/x u u 6 2 . c o m.mp4': 'ad',
    })
    env.settings(s => (s.organize.enabled = true))
    const heat = env.itemOf('Heat.1995.1080p.mkv')
    const ad = env.path('电影/Heat.1995.1080p/x u u 6 2 . c o m.mp4')
    const plan = await env.service.writer.previewOrganize([heat])
    expect(plan.entries.filter(e => e.conflict)).toEqual([])
    expect(plan.entries.find(e => e.from === ad)).toMatchObject({
      kind: 'delete',
      to: '',
    })
    const video = plan.entries.find(e => e.kind === 'video')!
    expect(video.to).toBe(env.path('电影/盗火线 (1995)/盗火线 (1995).mkv'))

    const { batchId } = env.service.writer.applyOrganize(plan.planId)
    await env.service.queue.idle()
    expect(existsSync(ad)).toBe(false)
    expect(existsSync(env.path('电影/Heat.1995.1080p'))).toBe(false)
    expect(read(video.to)).toBe('x'.repeat(10_000))

    env.service.writer.undoOrganize(batchId)
    await env.service.queue.idle()
    expect(read(env.path('电影/Heat.1995.1080p/Heat.1995.1080p.mkv'))).toBe(
      'x'.repeat(10_000)
    )
    expect(existsSync(ad)).toBe(false)
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

  it('剧集整理保留分类目录，不移动分类目录下的其他剧', async () => {
    const env = await engine('tv', {
      '合集/请回答1988/Season 1/请回答1988.S01E02.mkv': 'e2',
    })
    const id = env.itemOf('请回答1988.S01E02.mkv')
    tree.write('合集/另一部剧/Season 1/other.S01E01.mkv', 'other')
    tree.write('合集/共享海报.jpg', 'shared')
    env.settings(s => (s.organize.enabled = true))

    const plan = await env.service.writer.previewOrganize([id])
    expect(plan.entries.some(e => e.kind === 'video' && !e.conflict)).toBe(true)
    expect(plan.entries.find(e => e.kind === 'video')?.to).toContain(
      env.path('合集/请回答1988 (2015)')
    )
    expect(plan.entries.some(e => e.from === env.path('合集/另一部剧'))).toBe(
      false
    )
    expect(
      plan.entries.some(e => e.from === env.path('合集/共享海报.jpg'))
    ).toBe(false)
    env.service.writer.applyOrganize(plan.planId)
    await env.service.queue.idle()
    expect(read(env.path('合集/另一部剧/Season 1/other.S01E01.mkv'))).toBe(
      'other'
    )
    expect(read(env.path('合集/共享海报.jpg'))).toBe('shared')
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
    const outputs = new WriterStore(env.service.db)
    const actorPath = env.path('请回答1988/.actors/a.jpg')
    const actorRecord = { hash: 'actor', size: 1, mtime: 0, fields: null }
    outputs.putOutput(actorPath, id, 'image', actorRecord, Date.now())
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
    expect(outputs.output(actorPath)).toBeUndefined()
    expect(outputs.output(join(showDir, '.actors/a.jpg'))).toEqual(actorRecord)
    await env.service.close()
  })

  it('散放在根目录的新集并入这部剧已有的剧文件夹，不在根目录另建（ADR-0029）', async () => {
    const home = '剧集/大陆/请回答1988 (2015)(1)'
    const env = await engine('tv', {
      [`${home}/Season 01/请回答1988.S01E01.mkv`]: 'e1',
      [`${home}/Season 01/请回答1988.S01E02.mkv`]: 'e2',
      '请回答1988.S01E03.mkv': 'e3',
    })
    env.settings(s => (s.organize.enabled = true))
    const loose = env.itemOf('请回答1988.S01E03.mkv')
    expect(loose).not.toBe(env.itemOf('请回答1988.S01E01.mkv'))

    const plan = await env.service.writer.previewOrganize([loose])
    const video = plan.entries.find(e => e.kind === 'video')!
    expect(video.conflict).toBeUndefined()
    expect(dirname(video.to)).toBe(env.path(`${home}/Season 01`))
    env.service.writer.applyOrganize(plan.planId)
    await env.service.queue.idle()
    expect(read(video.to)).toBe('e3')
    expect(existsSync(env.path('请回答1988 (2015)'))).toBe(false)
    await env.service.close()
  })

  it('并入时散存文件夹里的 nfo 家里已有：留在原处，不拦下视频', async () => {
    const home = '剧集/请回答1988'
    const env = await engine('tv', {
      [`${home}/Season 1/请回答1988.S01E01.mkv`]: 'e1',
      [`${home}/Season 1/请回答1988.S01E02.mkv`]: 'e2',
      [`${home}/tvshow.nfo`]: '<tvshow/>',
      '新下载/请回答1988 (2015)/请回答1988.S01E03.mkv': 'e3',
      '新下载/请回答1988 (2015)/tvshow.nfo': '<tvshow/>',
    })
    env.settings(s => (s.organize.enabled = true))
    const loose = env.itemOf('请回答1988.S01E03.mkv')
    const plan = await env.service.writer.previewOrganize([loose])
    expect(plan.entries.filter(e => e.conflict)).toEqual([])
    const video = plan.entries.find(e => e.kind === 'video')!
    // 家里已有的季文件夹叫 Season 1，进它而不是按模板再建 Season 01
    expect(dirname(video.to)).toBe(env.path(`${home}/Season 1`))
    expect(
      plan.entries.some(e =>
        e.from.endsWith(join('请回答1988 (2015)', 'tvshow.nfo'))
      )
    ).toBe(false)
    await env.service.close()
  })

  it('并入家后散存文件夹只剩片库写出的重复文件：删掉，散存文件夹整个消失', async () => {
    const home = '剧集/请回答1988'
    const stray = '新下载/请回答1988 (2015)'
    const env = await engine('tv', {
      [`${home}/Season 1/请回答1988.S01E01.mkv`]: 'e1',
      [`${home}/Season 1/请回答1988.S01E02.mkv`]: 'e2',
      [`${home}/tvshow.nfo`]: '<tvshow>home</tvshow>',
      [`${stray}/请回答1988.S01E03.mkv`]: 'e3',
      [`${stray}/tvshow.nfo`]: '<tvshow>stray</tvshow>',
    })
    env.settings(s => (s.organize.enabled = true))
    const loose = env.itemOf('请回答1988.S01E03.mkv')
    const record = { hash: 'nfo', size: 1, mtime: 0, fields: null }
    new WriterStore(env.service.db).putOutput(
      env.path(`${stray}/tvshow.nfo`),
      loose,
      'nfo',
      record,
      Date.now()
    )

    const plan = await env.service.writer.previewOrganize([loose])
    expect(plan.entries.filter(e => e.conflict)).toEqual([])
    expect(
      plan.entries.find(e => e.from === env.path(`${stray}/tvshow.nfo`))
    ).toMatchObject({ kind: 'delete' })
    env.service.writer.applyOrganize(plan.planId)
    await env.service.queue.idle()
    expect(existsSync(env.path(stray))).toBe(false)
    expect(read(env.path(`${home}/tvshow.nfo`))).toBe('<tvshow>home</tvshow>')
    await env.service.close()
  })

  it('同一批里家文件夹自己也改名：散存的集跟到家的新名字，不分在两处', async () => {
    const env = await engine('tv', {
      'Reply.1988.S01.1080p-GRP/Reply.1988.S01E01.mkv': 'e1',
      'Reply.1988.S01.1080p-GRP/Reply.1988.S01E02.mkv': 'e2',
      '请回答1988.S01E03.mkv': 'e3',
    })
    env.settings(s => (s.organize.enabled = true))
    const home = env.itemOf('Reply.1988.S01E01.mkv')
    const loose = env.itemOf('请回答1988.S01E03.mkv')
    for (const order of [
      [home, loose],
      [loose, home],
    ]) {
      const plan = await env.service.writer.previewOrganize(order)
      const videos = plan.entries.filter(e => e.kind === 'video')
      expect(videos.filter(e => e.conflict)).toEqual([])
      expect(new Set(videos.map(e => dirname(e.to)))).toEqual(
        new Set([dirname(videos[0].to)])
      )
      expect(dirname(videos[0].to)).toMatch(
        /请回答1988 \(2015\)[\\/]Season 01$/
      )
    }
    await env.service.close()
  })

  it('视频都在剧文件夹里时照常按模板改名，不因为「家」而停在旧名字', async () => {
    const env = await engine('tv', {
      'Reply.1988.S01.1080p-GRP/Reply.1988.S01E01.mkv': 'e1',
    })
    env.settings(s => (s.organize.enabled = true))
    const id = env.itemOf('Reply.1988.S01E01.mkv')
    const plan = await env.service.writer.previewOrganize([id])
    const video = plan.entries.find(e => e.kind === 'video')!
    expect(video.to).toContain('请回答1988 (2015)')
    await env.service.close()
  })
})
