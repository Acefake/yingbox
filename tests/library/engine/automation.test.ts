/**
 * 库级自动化：自动后续分组规则、IPC 参数解析、设置持久化，以及真实引擎里的
 * 自动识别开关、识别后先整理再写出、监控 + 写入稳定判定端到端。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openLibraryDb } from '../../../src/main/library/db/database'
import { LibraryService } from '../../../src/main/library/engine/service'
import type { FollowupSpec } from '../../../src/main/library/jobs/followups'
import { LibraryStore } from '../../../src/main/library/libraries/library-store'
import {
  afterAutoOrganize,
  autoFollowups,
} from '../../../src/main/library/writer/auto-rules'
import {
  DEFAULT_LIBRARY_AUTOMATION,
  DEFAULT_WRITER_SETTINGS,
  type LibraryAutomation,
  type LibraryEvent,
  type WriterSettings,
  parseRpcParams,
} from '../../../src/shared/library/ipc'
import { FAKE_TOKEN, FakeTmdb } from '../providers/fake-tmdb'
import { ageTree, tempTree } from './helpers'

const settings = (patch: (s: WriterSettings) => void): WriterSettings => {
  const s = structuredClone(DEFAULT_WRITER_SETTINGS)
  patch(s)
  return s
}

describe('autoFollowups', () => {
  const automation = (a: Partial<LibraryAutomation>): LibraryAutomation => ({
    ...DEFAULT_LIBRARY_AUTOMATION,
    ...a,
  })
  const libs = new Map<number, LibraryAutomation>([
    [1, automation({})],
    [2, automation({ write: 'on' })],
    [3, automation({ write: 'off', organize: true })],
    [4, automation({ write: 'on', organize: true })],
  ])
  // 条目 id 的十位是库号：11 在库 1、42 在库 4
  const deps = {
    libraryOf: (id: number) => (id === 99 ? undefined : Math.floor(id / 10)),
    automationOf: (id: number) => libs.get(id),
  }

  const write = (itemIds: number[]): FollowupSpec => ({
    type: 'writer-write',
    key: 'writer-write',
    payload: { itemIds },
    priority: 2,
  })

  it('inherit 跟随全局「识别后自动写出」，on / off 以库为准', () => {
    expect(autoFollowups([11, 21], DEFAULT_WRITER_SETTINGS, deps)).toEqual([
      write([21]),
    ])
    const auto = settings(s => (s.autoWriteAfterIdentify = true))
    expect(autoFollowups([11, 21, 99], auto, deps)).toEqual([write([11, 21])])
  })

  it('整理要库开关和全局总闸都开；要写出的条目放到整理之后（整理只试一次）', () => {
    expect(autoFollowups([31, 41], DEFAULT_WRITER_SETTINGS, deps)).toEqual([
      write([41]),
    ])
    const on = settings(s => (s.organize.enabled = true))
    expect(autoFollowups([31, 41, 41, 11], on, deps)).toEqual([
      {
        type: 'writer-auto-organize',
        key: 'writer-auto-organize',
        payload: { itemIds: [31, 41], writeAfter: [41] },
        priority: 2,
        maxAttempts: 1,
      },
    ])
  })

  it('自动整理的后继：writeAfter 有条目才写出', () => {
    expect(afterAutoOrganize({ itemIds: [31, 41], writeAfter: [41] })).toEqual([
      write([41]),
    ])
    expect(afterAutoOrganize({ itemIds: [31], writeAfter: [] })).toEqual([])
  })
})

describe('IPC 参数与持久化', () => {
  it('updateLibrary：只认识的字段、类型要对；name 与 automation 至少一个', () => {
    expect(
      parseRpcParams('updateLibrary', {
        libraryId: 3,
        automation: { watch: false, write: 'on', junk: 1 },
      })
    ).toEqual({
      libraryId: 3,
      name: undefined,
      automation: { watch: false, write: 'on' },
    })
    expect(() =>
      parseRpcParams('updateLibrary', {
        libraryId: 3,
        automation: { write: 'x' },
      })
    ).toThrow(/automation.write/)
    expect(() =>
      parseRpcParams('updateLibrary', {
        libraryId: 3,
        automation: { watch: 'yes' },
      })
    ).toThrow(/布尔/)
    expect(() => parseRpcParams('updateLibrary', { libraryId: 3 })).toThrow(
      /至少/
    )
    expect(
      parseRpcParams('addLibrary', {
        root: '/m',
        kind: 'movie',
        automation: { identify: false },
      }).automation
    ).toEqual({ identify: false })
  })

  it('新库用默认值；更新只改给出的字段；坏 JSON 按默认值读', () => {
    const db = openLibraryDb(':memory:')
    const store = new LibraryStore(db)
    const lib = store.add(
      { root: '/m/a', kind: 'movie', automation: { organize: true } },
      1
    )
    expect(lib.automation).toEqual({
      ...DEFAULT_LIBRARY_AUTOMATION,
      organize: true,
    })
    const updated = store.update({
      libraryId: lib.id,
      name: '新名字',
      automation: { write: 'off' },
    })
    expect(updated.name).toBe('新名字')
    expect(updated.automation).toEqual({
      ...DEFAULT_LIBRARY_AUTOMATION,
      organize: true,
      write: 'off',
    })
    db.prepare('UPDATE libraries SET automation = ? WHERE id = ?').run(
      '{oops',
      lib.id
    )
    expect(store.get(lib.id).automation).toEqual(DEFAULT_LIBRARY_AUTOMATION)
    db.close()
  })
})

describe('引擎里的库级自动化', () => {
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

  const engine = async (
    options: {
      before?: (s: LibraryService) => void
      service?: Partial<ConstructorParameters<typeof LibraryService>[0]>
    } = {}
  ): Promise<{ service: LibraryService; events: LibraryEvent[] }> => {
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
      ...options.service,
    })
    service.subscribe(e => events.push(e))
    await service.start()
    options.before?.(service)
    return { service, events }
  }
  const queued = (events: LibraryEvent[]): string[] =>
    events.flatMap(e =>
      e.type === 'job' && e.state === 'queued' ? [e.jobType] : []
    )

  it('关闭自动识别：扫描入库但不排识别；updateLibrary 广播新的设置', async () => {
    tree.write('Heat.1995.1080p.mkv')
    const { service, events } = await engine()
    const lib = await service.addLibrary({
      root: tree.root,
      kind: 'movie',
      automation: { identify: false },
    })
    await service.queue.idle()
    expect(queued(events)).toContain('scan')
    expect(queued(events)).not.toContain('identify')

    const updated = await service.updateLibrary({
      libraryId: lib.id,
      automation: { identify: true },
    })
    expect(updated.automation.identify).toBe(true)
    const changed = events.filter(e => e.type === 'libraries-changed').at(-1)
    expect(changed).toMatchObject({
      libraries: [{ id: lib.id, automation: { identify: true } }],
    })
    await service.close()
  })

  it('自动整理 + 自动写出：识别后先按模板整理，再把 NFO 写到新位置；批次可撤销', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const { service, events } = await engine({
      before: s =>
        s.writer.setSettings(settings(w => (w.organize.enabled = true))),
    })
    await service.addLibrary({
      root: tree.root,
      kind: 'movie',
      automation: { organize: true, write: 'on' },
    })
    await service.queue.idle()
    const at = (p: string): string => join(tree.root, p)
    expect(existsSync(at('Heat.1995.1080p.mkv'))).toBe(false)
    expect(existsSync(at('盗火线 (1995)/盗火线 (1995).mkv'))).toBe(true)
    expect(existsSync(at('盗火线 (1995)/盗火线 (1995).nfo'))).toBe(true)
    const types = queued(events)
    expect(types.indexOf('writer-auto-organize')).toBeLessThan(
      types.indexOf('writer-write')
    )
    expect(service.writer.listOrganizeBatches()[0]).toMatchObject({
      state: 'done',
      moved: 1,
    })
    await service.close()
  })

  it('全局「允许整理文件」关着时库开关不生效，也不写出（写出跟随全局默认关）', async () => {
    tree.write('Heat.1995.1080p.mkv', 'heat')
    const { service, events } = await engine()
    await service.addLibrary({
      root: tree.root,
      kind: 'movie',
      automation: { organize: true },
    })
    await service.queue.idle()
    expect(existsSync(join(tree.root, 'Heat.1995.1080p.mkv'))).toBe(true)
    expect(queued(events)).not.toContain('writer-auto-organize')
    expect(queued(events)).not.toContain('writer-write')
    await service.close()
  })

  it('监控 + 写入稳定判定：新文件等大小 / mtime 不变一段时间后才入库', async () => {
    tree.write('A (2001)/A (2001).mkv')
    ageTree(tree.root)
    const { service, events } = await engine({
      service: { watch: true, watchQuietMs: 30, settleMs: 400 },
    })
    try {
      const lib = await service.addLibrary({
        root: tree.root,
        kind: 'movie',
        automation: { identify: false },
      })
      await service.queue.idle()
      // 首扫：存量文件 mtime 足够旧，直接收
      expect(service.listLibraries()[0].lastScanAt).not.toBeNull()
      const started = Date.now()
      const added = new Promise<number>(resolve =>
        service.subscribe(e => {
          if (e.type === 'items-changed' && e.added.length) resolve(Date.now())
        })
      )
      tree.write('B (2002)/B (2002).mkv', 'b')
      const at = await Promise.race([
        added,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('5 秒内没有入库')), 5000)
        ),
      ])
      expect(at - started).toBeGreaterThanOrEqual(400)
      await service.queue.idle()
      expect(
        events.some(e => e.type === 'items-changed' && e.libraryId === lib.id)
      ).toBe(true)
    } finally {
      await service.close()
    }
  }, 10_000)
})
