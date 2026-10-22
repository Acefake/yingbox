/**
 * 后继派发的特征测试：真实引擎（内存库、临时目录、假 TMDB / 假番号站点）里，各后台任务结束后
 * 排进 jobs 表的后续任务（类型、键、载荷、优先级、重试次数）。重构成声明式 followups 前后都必须一致。
 *
 * 链路：扫描有新增 / 变化 → 识别（库开了自动识别、TMDB 库要有令牌）+ 指纹（网盘不排）；
 * 识别有变化 → 演员自动查资料（番号库、有待查演员）+ 按库设置写出 / 先整理再写出；
 * 自动整理结束（成功或失败）→ 写出；手动匹配成功同识别。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type LibraryJobDeps,
  changeFollowups,
} from '../../../src/main/library/engine/library-jobs'
import {
  LibraryService,
  type LibraryServiceOptions,
} from '../../../src/main/library/engine/service'
import {
  DEFAULT_WRITER_SETTINGS,
  type LibraryAutomation,
} from '../../../src/shared/library/ipc'
import { FAKE_TOKEN, FakeTmdb } from '../providers/fake-tmdb'
import { tempTree } from './helpers'

/** jobs 表里的一行（不含 id / 状态以外的时间字段）。 */
interface JobRow {
  type: string
  key: string | null
  payload: unknown
  priority: number
  maxAttempts: number
  state: string
}

const JAV_PAGE = readFileSync(
  join(__dirname, '../../fixtures/jav/javbus-SSIS-497.html'),
  'utf8'
)

/** 番号站点假网络：只认 SSIS-497，图片给 4 字节 JPEG，别的 404。 */
const javFetch = async (url: string): Promise<Response> => {
  if (url === 'https://www.javbus.com/SSIS-497')
    return new Response(JAV_PAGE, { headers: { 'content-type': 'text/html' } })
  if (/\.jpe?g$/.test(url))
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { 'content-type': 'image/jpeg' },
    })
  return new Response('not found', { status: 404 })
}

let tree: ReturnType<typeof tempTree>
let mediaDir: string
const services: LibraryService[] = []
beforeEach(() => {
  tree = tempTree()
  mediaDir = mkdtempSync(join(tmpdir(), 'yingbox-media-'))
})
afterEach(async () => {
  for (const s of services.splice(0)) await s.close()
  tree.cleanup()
  rmSync(mediaDir, { recursive: true, force: true })
})

/** 起一个引擎：默认 TMDB 有令牌、本地盘（不查 fs-type）、指纹固定值。 */
async function engine(
  options: {
    token?: boolean
    jav?: boolean
  } & Partial<LibraryServiceOptions> = {}
): Promise<LibraryService> {
  const { token = true, jav = false, ...rest } = options
  const tmdb = new FakeTmdb({ token: FAKE_TOKEN })
  const service = new LibraryService({
    dbPath: ':memory:',
    watch: false,
    detectFs: async () => undefined,
    fingerprint: async () => 'abcdef0123456789',
    identify: {
      fetch: jav ? javFetch : tmdb.fetch,
      mediaDir,
      env: token ? { tmdbToken: FAKE_TOKEN } : {},
      probeDuration: async () => undefined,
      http: { rps: 1000 },
    },
    ...rest,
  })
  services.push(service)
  await service.start()
  return service
}

/** 等任务链跑完：队列空闲后再等一拍，给异步派发（存储判定后才排的指纹）落库的时间。 */
async function settle(service: LibraryService): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await service.queue.idle()
    await new Promise(r => setTimeout(r, 30))
  }
  await service.queue.idle()
}

function jobs(service: LibraryService): JobRow[] {
  return service.db
    .prepare(
      'SELECT type, key, payload, priority, max_attempts AS maxAttempts, state FROM jobs ORDER BY id'
    )
    .all()
    .map(r => ({
      type: String(r.type),
      key: r.key === null ? null : String(r.key),
      payload: JSON.parse(String(r.payload)),
      priority: Number(r.priority),
      maxAttempts: Number(r.maxAttempts),
      state: String(r.state),
    }))
}

/** 按类型排序后的派发记录（派发顺序随实现可变，内容不变）。 */
const dispatched = (service: LibraryService): Omit<JobRow, 'state'>[] =>
  jobs(service)
    .map(({ state: _, ...j }) => j)
    .sort((a, b) => (a.type + a.key).localeCompare(b.type + b.key))

const add = (
  service: LibraryService,
  automation: Partial<LibraryAutomation> = {},
  source?: 'jav'
): ReturnType<LibraryService['addLibrary']> =>
  service.addLibrary({
    root: tree.root,
    kind: 'movie',
    ...(source ? { source } : {}),
    automation: { storage: 'local', ...automation },
  })

const SCAN = (libraryId: number): Omit<JobRow, 'state'> => ({
  type: 'scan',
  key: `library:${libraryId}`,
  payload: { libraryId },
  priority: 20,
  maxAttempts: 3,
})
const FINGERPRINT = (libraryId: number): Omit<JobRow, 'state'> => ({
  type: 'fingerprint',
  key: `fingerprint:${libraryId}`,
  payload: { libraryId },
  priority: 0,
  maxAttempts: 3,
})
const IDENTIFY = (libraryId: number): Omit<JobRow, 'state'> => ({
  type: 'identify',
  key: `identify:identify:library:${libraryId}`,
  payload: { mode: 'identify', libraryId },
  priority: 3,
  maxAttempts: 3,
})

describe('扫描后的后继', () => {
  it('本地盘新增条目：排识别（自动优先级）+ 指纹；都跑完', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine()
    const lib = await add(service)
    await settle(service)
    expect(dispatched(service)).toEqual([
      FINGERPRINT(lib.id),
      IDENTIFY(lib.id),
      SCAN(lib.id),
    ])
    expect(jobs(service).every(j => j.state === 'done')).toBe(true)
  })

  it('网盘：排识别、不排指纹（沿用存储判定）', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine()
    const lib = await add(service, { storage: 'cloud' })
    await settle(service)
    expect(dispatched(service)).toEqual([IDENTIFY(lib.id), SCAN(lib.id)])
  })

  it('存储 auto 判为网盘（fs-type 不可靠）同样不排指纹', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine({ detectFs: async () => 'nfs' })
    const lib = await add(service, { storage: 'auto' })
    await settle(service)
    expect(dispatched(service).map(j => j.type)).toEqual(['identify', 'scan'])
    expect(lib.id).toBeGreaterThan(0)
  })

  it('库关了自动识别：只排指纹', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine()
    const lib = await add(service, { identify: false })
    await settle(service)
    expect(dispatched(service)).toEqual([FINGERPRINT(lib.id), SCAN(lib.id)])
  })

  it('TMDB 库没有令牌：不排识别；番号库不要令牌照排', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine({ token: false })
    const lib = await add(service)
    await settle(service)
    expect(dispatched(service).map(j => j.type)).toEqual([
      'fingerprint',
      'scan',
    ])

    const jav = tempTree()
    try {
      jav.write('SSIS-497/SSIS-497.mp4', 'x')
      const other = await engine({ token: false, jav: true })
      const javLib = await other.addLibrary({
        root: jav.root,
        kind: 'movie',
        source: 'jav',
        automation: { storage: 'local', write: 'off' },
      })
      await settle(other)
      expect(dispatched(other).map(j => j.type)).toContain('identify')
      expect(dispatched(other)).toContainEqual(IDENTIFY(javLib.id))
    } finally {
      jav.cleanup()
    }
    expect(lib.id).toBeGreaterThan(0)
  })

  it('没有变化的重扫：不再派识别 / 指纹', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine()
    const lib = await add(service, { identify: false })
    await settle(service)
    const before = jobs(service).length
    service.scan({ libraryId: lib.id })
    await settle(service)
    const after = jobs(service).slice(before)
    expect(after.map(j => j.type)).toEqual(['scan'])
  })

  it('文件内容变了（没有新增）的重扫：再排指纹', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine()
    const lib = await add(service, { identify: false })
    await settle(service)
    tree.write('Heat.1995.1080p.mkv', 'heat, but longer now')
    service.scan({ libraryId: lib.id, full: true })
    await settle(service)
    expect(jobs(service).map(j => j.type)).toEqual([
      'scan',
      'fingerprint',
      'scan',
      'fingerprint',
    ])
  })

  it('空库：扫描没有条目，什么都不派', async () => {
    const service = await engine()
    const lib = await add(service)
    await settle(service)
    expect(dispatched(service)).toEqual([SCAN(lib.id)])
  })
})

describe('重解析后的后继', () => {
  it('解析版本落后、重新分组出变化：排识别（不排指纹）', async () => {
    tree.write('Dune (2021)/Dune (2021).mkv', 'dune')
    const dbPath = join(mediaDir, 'library.db')
    const first = await engine({ dbPath })
    const lib = await add(first, { identify: false })
    await settle(first)
    await first.updateLibrary({
      libraryId: lib.id,
      automation: { identify: true },
    })
    // 模拟旧版本解析器写入的错误分组
    first.db.exec(`UPDATE files SET parser_version = 0;
      UPDATE media_items SET title = '旧标题', local_key = 'movie:1:old:'`)
    await first.close()
    services.splice(services.indexOf(first), 1)

    const second = await engine({ dbPath })
    await settle(second)
    const rows = jobs(second)
    const parse = rows.findIndex(j => j.type === 'parse')
    expect(parse).toBeGreaterThan(0)
    expect(rows.slice(parse).map(({ state: _, ...j }) => j)).toEqual([
      {
        type: 'parse',
        key: `parse:${lib.id}`,
        payload: { libraryId: lib.id },
        priority: 5,
        maxAttempts: 3,
      },
      IDENTIFY(lib.id),
    ])
  })
})

describe('识别后的后继', () => {
  it('库设置写出 on：识别出变化的条目排写出（自动优先级、键 writer-write）', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine()
    const lib = await add(service, { write: 'on' })
    await settle(service)
    const write = dispatched(service).filter(j => j.type === 'writer-write')
    const item = service.db.prepare('SELECT id FROM media_items').get()!
    expect(write).toEqual([
      {
        type: 'writer-write',
        key: 'writer-write',
        payload: { itemIds: [Number(item.id)] },
        priority: 2,
        maxAttempts: 3,
      },
    ])
    expect(lib.id).toBeGreaterThan(0)
  })

  it('写出跟随全局（默认关）且不整理：识别后什么都不派', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine()
    await add(service)
    await settle(service)
    expect(dispatched(service).map(j => j.type)).toEqual([
      'fingerprint',
      'identify',
      'scan',
    ])
  })

  it('整理 + 写出：先排自动整理（只试一次），整理结束后再排写出', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine()
    service.writer.setSettings({
      ...structuredClone(DEFAULT_WRITER_SETTINGS),
      organize: { ...DEFAULT_WRITER_SETTINGS.organize, enabled: true },
    })
    await add(service, { organize: true, write: 'on' })
    await settle(service)
    const item = Number(
      service.db.prepare('SELECT id FROM media_items').get()!.id
    )
    const rows = jobs(service)
    const organize = rows.findIndex(j => j.type === 'writer-auto-organize')
    const write = rows.findIndex(j => j.type === 'writer-write')
    expect(rows[organize]).toMatchObject({
      key: 'writer-auto-organize',
      payload: { itemIds: [item], writeAfter: [item] },
      priority: 2,
      maxAttempts: 1,
      state: 'done',
    })
    expect(write).toBeGreaterThan(organize)
    expect(rows[write]).toMatchObject({
      key: 'writer-write',
      payload: { itemIds: [item] },
      priority: 2,
    })
  })

  it('自动整理失败也照排写出', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine({
      writer: {
        deviceOf: async () => {
          throw new Error('读不到设备号')
        },
      },
    })
    service.writer.setSettings({
      ...structuredClone(DEFAULT_WRITER_SETTINGS),
      organize: { ...DEFAULT_WRITER_SETTINGS.organize, enabled: true },
    })
    await add(service, { organize: true, write: 'on' })
    await settle(service)
    const rows = jobs(service)
    expect(rows.find(j => j.type === 'writer-auto-organize')?.state).toBe(
      'failed'
    )
    expect(rows.filter(j => j.type === 'writer-write')).toHaveLength(1)
  })

  it('番号库识别出演员：排演员自动查资料（最低优先级）', async () => {
    tree.write('SSIS-497/SSIS-497.mp4', 'x')
    const service = await engine({ jav: true })
    await add(service, { write: 'off' }, 'jav')
    await settle(service)
    expect(dispatched(service)).toContainEqual({
      type: 'actor-profile',
      key: 'actor-profile:auto',
      payload: { mode: 'auto' },
      priority: -10,
      maxAttempts: 3,
    })
  })
})

describe('手动匹配后的后继', () => {
  it('匹配成功按识别后同样派写出', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const service = await engine()
    await add(service, { identify: false, write: 'on' })
    await settle(service)
    const item = Number(
      service.db.prepare('SELECT id FROM media_items').get()!.id
    )
    expect(dispatched(service).map(j => j.type)).not.toContain('writer-write')
    const result = await service.applyMatch({
      itemId: item,
      query: { title: 'Heat', year: 1995 },
    })
    expect(result.status).toBe('matched')
    await settle(service)
    expect(dispatched(service).filter(j => j.type === 'writer-write')).toEqual([
      {
        type: 'writer-write',
        key: 'writer-write',
        payload: { itemIds: [item] },
        priority: 2,
        maxAttempts: 3,
      },
    ])
  })
})

describe('扫描 / 重解析的后继规则', () => {
  const deps = (
    cloud: boolean,
    identify = true
  ): Pick<LibraryJobDeps, 'identifyFollowup' | 'isCloudLibrary'> => ({
    identifyFollowup: (id: number) =>
      identify
        ? {
            type: 'identify',
            key: `identify:identify:library:${id}`,
            payload: { mode: 'identify', libraryId: id },
            priority: 3,
          }
        : null,
    isCloudLibrary: async () => cloud,
  })

  it('条目有变化排识别；文件有新增 / 变化且不在网盘上再排指纹', async () => {
    const both = { libraryId: 4, itemsChanged: true, filesChanged: true }
    expect((await changeFollowups(deps(false), both)).map(s => s.key)).toEqual([
      'identify:identify:library:4',
      'fingerprint:4',
    ])
    expect((await changeFollowups(deps(true), both)).map(s => s.key)).toEqual([
      'identify:identify:library:4',
    ])
    expect(
      (await changeFollowups(deps(false, false), both)).map(s => s.key)
    ).toEqual(['fingerprint:4'])
  })

  it('重解析（不读文件）只排识别；没有变化什么都不排', async () => {
    expect(
      (
        await changeFollowups(deps(false), {
          libraryId: 2,
          itemsChanged: true,
          filesChanged: false,
        })
      ).map(s => s.type)
    ).toEqual(['identify'])
    expect(
      await changeFollowups(deps(false), {
        libraryId: 2,
        itemsChanged: false,
        filesChanged: false,
      })
    ).toEqual([])
  })
})
