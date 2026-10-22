/**
 * 网盘 / 挂载盘模式：存储设置的默认值与解析、存储判定（auto / 用户覆盖）、监控通道（不监听不定时扫描）、
 * 网盘上读视频的规矩（后台跳过、按需限速）、外部变更通知（路径对应、去抖合并），
 * 以及真实 LibraryService 里的整条链路：通知 → 按目录增量扫描、网盘不算指纹、预览不给视频。
 */
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLOUD_READ_INTERVAL_MS,
  Pacer,
  forCloud,
} from '../../../src/main/library/engine/cloud-reads'
import {
  ExternalChanges,
  NOTIFY_QUIET_MS,
  mapNoticePath,
} from '../../../src/main/library/engine/external-changes'
import { LibraryMonitor } from '../../../src/main/library/engine/library-monitor'
import { handleRpc } from '../../../src/main/library/engine/rpc'
import { LibraryService } from '../../../src/main/library/engine/service'
import {
  StorageModes,
  isNetworkPath,
} from '../../../src/main/library/engine/storage-mode'
import {
  type LibraryEvent,
  type LibraryInfo,
  type LibraryStorage,
  normalizeLibraryQuery,
  parseRpcParams,
  withAutomationDefaults,
} from '../../../src/shared/library/ipc'
import { ageTree, tempTree } from './helpers'

afterEach(() => {
  vi.useRealTimers()
})

const target = (
  root: string,
  storage: LibraryStorage = 'auto'
): { root: string; automation: { storage: LibraryStorage } } => ({
  root,
  automation: { storage },
})

describe('存储设置', () => {
  it('缺省 auto；旧数据没有 storage、坏值都回到 auto', () => {
    expect(withAutomationDefaults(null).storage).toBe('auto')
    expect(withAutomationDefaults({ watch: false }).storage).toBe('auto')
    expect(
      withAutomationDefaults({ storage: 'nas' as LibraryStorage }).storage
    ).toBe('auto')
    expect(withAutomationDefaults({ storage: 'cloud' }).storage).toBe('cloud')
  })

  it('updateLibrary 认 storage 三个取值，别的拒绝', () => {
    expect(
      parseRpcParams('updateLibrary', {
        libraryId: 1,
        automation: { storage: 'local' },
      }).automation
    ).toEqual({ storage: 'local' })
    expect(() =>
      parseRpcParams('updateLibrary', {
        libraryId: 1,
        automation: { storage: 'nas' },
      })
    ).toThrow(/storage/)
  })

  it('notifyChanges 参数：非空数组、动作白名单、空 destination 丢掉', () => {
    expect(
      parseRpcParams('notifyChanges', {
        changes: [
          { action: 'create', path: ' /115/电影/A.mkv ', destination: '' },
          { action: 'rename', path: '/a', destination: '/b' },
        ],
        mountRoot: 'D:\\CloudDrive',
      })
    ).toEqual({
      changes: [
        { action: 'create', path: '/115/电影/A.mkv' },
        { action: 'rename', path: '/a', destination: '/b' },
      ],
      mountRoot: 'D:\\CloudDrive',
    })
    expect(() => parseRpcParams('notifyChanges', { changes: [] })).toThrow()
    expect(() =>
      parseRpcParams('notifyChanges', {
        changes: [{ action: 'chmod', path: '/a' }],
      })
    ).toThrow(/action/)
    expect(() =>
      parseRpcParams('notifyChanges', { changes: [{ action: 'create' }] })
    ).toThrow(/path/)
  })
})

describe('StorageModes', () => {
  it('用户指定 local / cloud 直接用，不查文件系统', async () => {
    const detect = vi.fn(async () => 'nfs')
    const modes = new StorageModes(detect)
    expect(await modes.isCloud(target('/mnt/nas', 'local'))).toBe(false)
    expect(await modes.isCloud(target('/media', 'cloud'))).toBe(true)
    expect(modes.known(target('/media', 'cloud'))).toBe(true)
    expect(detect).not.toHaveBeenCalled()
  })

  it('auto：UNC 不查 fs-type 判网盘；fs-type 不可靠判网盘；判定按根目录缓存', async () => {
    const detect = vi.fn(async (root: string) =>
      root === '/mnt/nas' ? 'cifs' : undefined
    )
    const modes = new StorageModes(detect)
    expect(modes.known(target('/mnt/nas'))).toBeUndefined()
    expect(await modes.isCloud(target('\\\\nas\\movies'))).toBe(true)
    expect(detect).not.toHaveBeenCalled()
    expect(await modes.isCloud(target('/mnt/nas'))).toBe(true)
    expect(await modes.isCloud(target('/mnt/nas'))).toBe(true)
    expect(await modes.isCloud(target('/home/me/movies'))).toBe(false)
    expect(detect).toHaveBeenCalledTimes(2)
    expect(modes.known(target('/mnt/nas'))).toBe(true)
    expect(modes.known(target('/home/me/movies'))).toBe(false)
  })

  it('fs-type 查询失败按本地盘处理', async () => {
    const modes = new StorageModes(async () => {
      throw new Error('EIO')
    })
    expect(await modes.isCloud(target('/x'))).toBe(false)
  })

  it.each([
    ['\\\\nas\\movies\\a.mkv', true],
    ['//nas/movies/a.mkv', true],
    ['D:\\Movies\\a.mkv', false],
    ['/mnt/media/a.mkv', false],
  ])('isNetworkPath(%s) → %s', (path, expected) => {
    expect(isNetworkPath(path)).toBe(expected)
  })
})

describe('LibraryMonitor 网盘通道', () => {
  it('网盘：不监听、不定时扫描、不补扫，通道记为 external；remove 后为 off', async () => {
    vi.useFakeTimers()
    const tree = tempTree()
    const scans: Array<[number, string[] | null]> = []
    const m = new LibraryMonitor(
      {
        mode: 'events',
        pollIntervalMs: 1000,
        detectFs: async () => undefined,
        log: () => {},
      },
      (id, dirs) => scans.push([id, dirs])
    )
    try {
      await m.add(1, tree.root, true, true)
      expect(m.channel(1)).toBe('external')
      tree.write('A (2001)/A (2001).mkv')
      vi.advanceTimersByTime(5000)
      expect(scans).toEqual([])
      m.remove(1)
      expect(m.channel(1)).toBe('off')
      // 本地盘照旧：定时扫描 + 补扫
      await m.add(2, tree.root, true, false)
      expect(m.channel(2)).toBe('events')
      vi.advanceTimersByTime(1000)
      expect(scans).toEqual([
        [2, null],
        [2, null],
      ])
    } finally {
      m.close()
      tree.cleanup()
    }
  })
})

describe('网盘上读视频', () => {
  it('forCloud：本地直读；网盘没给 pacer 就跳过', async () => {
    const read = vi.fn(async (path: string) => `hash:${path}`)
    const wrapped = forCloud(read, async path => path.startsWith('/cloud'))
    expect(await wrapped('/local/a.mkv')).toBe('hash:/local/a.mkv')
    expect(await wrapped('/cloud/a.mkv')).toBeUndefined()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('Pacer：串行，上一个结束到下一个开始至少隔 intervalMs；失败不挡后面', async () => {
    vi.useFakeTimers()
    const pacer = new Pacer(1000)
    const started: number[] = []
    const t0 = Date.now()
    const task = (fail = false): Promise<number> =>
      pacer.run(async () => {
        started.push(Date.now() - t0)
        if (fail) throw new Error('读失败')
        return started.length
      })
    const a = task()
    const b = task(true)
    const c = task()
    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([0])
    await vi.advanceTimersByTimeAsync(999)
    expect(started).toEqual([0])
    await vi.advanceTimersByTimeAsync(1)
    expect(started).toEqual([0, 1000])
    await vi.advanceTimersByTimeAsync(1000)
    expect(started).toEqual([0, 1000, 2000])
    expect(await a).toBe(1)
    await expect(b).rejects.toThrow('读失败')
    expect(await c).toBe(3)
  })

  it('forCloud 给了 pacer：网盘按需读排队限速，默认间隔 1 秒', async () => {
    vi.useFakeTimers()
    expect(CLOUD_READ_INTERVAL_MS).toBe(1000)
    const read = vi.fn(async () => 42)
    const wrapped = forCloud(read, async () => true, new Pacer())
    const first = wrapped('/cloud/a.mkv')
    const second = wrapped('/cloud/b.mkv')
    await vi.advanceTimersByTimeAsync(0)
    expect(read).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(read).toHaveBeenCalledTimes(2)
    expect([await first, await second]).toEqual([42, 42])
  })
})

describe('外部变更通知：路径对应', () => {
  const libs = [
    { id: 1, root: '/mnt/cd2/115/电影' },
    { id: 2, root: '/mnt/cd2/阿里云盘/剧集' },
    { id: 3, root: '/home/me/Movies' },
  ]

  it('本机路径直接落在库下（含根目录本身）', () => {
    expect(mapNoticePath('/home/me/Movies/A (2001)/A.mkv', libs)).toEqual({
      libraryId: 3,
      root: '/home/me/Movies',
      path: '/home/me/Movies/A (2001)/A.mkv',
    })
    expect(mapNoticePath('/home/me/Movies', libs)?.libraryId).toBe(3)
    expect(mapNoticePath('/home/me/Movies2/a.mkv', libs)).toBeNull()
  })

  it('CloudDrive2 路径：库目录末尾几段对上通知路径开头几段', () => {
    expect(mapNoticePath('/115/电影/A (2001)/A.mkv', libs)).toEqual({
      libraryId: 1,
      root: '/mnt/cd2/115/电影',
      path: '/mnt/cd2/115/电影/A (2001)/A.mkv',
    })
    expect(mapNoticePath('/阿里云盘/剧集/S01', libs)?.path).toBe(
      '/mnt/cd2/阿里云盘/剧集/S01'
    )
    // 对上段数最多的胜出（后面只对上 1 段的库不抢）；对不上返回 null
    const nested = [...libs, { id: 4, root: '/other/115' }]
    expect(mapNoticePath('/115/电影/A.mkv', nested)?.libraryId).toBe(1)
    expect(mapNoticePath('/115/音乐/a.flac', nested)?.libraryId).toBe(4)
    expect(mapNoticePath('/115/音乐/a.flac', libs)).toBeNull()
  })

  it('并列对上同样段数时视为对不上', () => {
    const twins = [
      { id: 1, root: '/mnt/a/电影' },
      { id: 2, root: '/mnt/b/电影' },
    ]
    expect(mapNoticePath('/电影/A.mkv', twins)).toBeNull()
    expect(
      mapNoticePath('/电影/A.mkv', [...twins, { id: 3, root: '/x/y' }])
    ).toBeNull()
  })

  it('mountRoot：先拼挂载目录再找库（库就是整个挂载目录时只能靠它）', () => {
    const whole = [{ id: 9, root: '/mnt/cd2' }]
    expect(mapNoticePath('/115/电影/A.mkv', whole)).toBeNull()
    expect(mapNoticePath('/115/电影/A.mkv', whole, '/mnt/cd2')).toEqual({
      libraryId: 9,
      root: '/mnt/cd2',
      path: '/mnt/cd2/115/电影/A.mkv',
    })
  })
})

describe('外部变更通知：去抖合并', () => {
  it('每个库静默 2 秒后交出，同目录合并；改名两头都扫；根目录本身扫根目录', () => {
    vi.useFakeTimers()
    const scans: Array<[number, string[]]> = []
    const changes = new ExternalChanges(
      () => [
        { id: 1, root: '/mnt/cd2/115/电影' },
        { id: 2, root: '/data/tv' },
      ],
      (id, dirs) => scans.push([id, dirs.sort()])
    )
    expect(NOTIFY_QUIET_MS).toBe(2000)
    expect(
      changes.push({
        changes: [
          { action: 'create', path: '/115/电影/A (2001)/A.mkv' },
          { action: 'create', path: '/115/电影/A (2001)/A.nfo' },
          {
            action: 'rename',
            path: '/data/tv/Old/x.mkv',
            destination: '/data/tv/New/x.mkv',
          },
          { action: 'delete', path: '/elsewhere/z.mkv' },
        ],
      })
    ).toEqual({ accepted: 3, ignored: 1 })
    vi.advanceTimersByTime(1500)
    changes.push({ changes: [{ action: 'create', path: '/data/tv' }] })
    vi.advanceTimersByTime(499)
    expect(scans).toEqual([])
    // 各库各自去抖：库 1 静默满 2 秒先交出，库 2 被新通知推迟
    vi.advanceTimersByTime(1)
    expect(scans).toEqual([[1, ['/mnt/cd2/115/电影/A (2001)']]])
    vi.advanceTimersByTime(1499)
    expect(scans).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(scans[1]).toEqual([2, ['/data/tv', '/data/tv/New', '/data/tv/Old']])
    changes.close()
  })

  it('持续有通知时最长 10 秒交一次；forget 丢弃待交', () => {
    vi.useFakeTimers()
    const scans: Array<[number, string[]]> = []
    const changes = new ExternalChanges(
      () => [{ id: 1, root: '/m' }],
      (id, dirs) => scans.push([id, dirs])
    )
    for (let t = 0; t < 10_000; t += 1000) {
      changes.push({ changes: [{ action: 'create', path: `/m/d${t}/a.mkv` }] })
      vi.advanceTimersByTime(1000)
    }
    expect(scans).toHaveLength(1)
    expect(scans[0][1]).toHaveLength(10)
    changes.push({ changes: [{ action: 'create', path: '/m/x/a.mkv' }] })
    changes.forget(1)
    vi.advanceTimersByTime(20_000)
    expect(scans).toHaveLength(1)
  })
})

describe('LibraryService 网盘模式', () => {
  const services: LibraryService[] = []
  const trees: Array<ReturnType<typeof tempTree>> = []
  afterEach(async () => {
    for (const s of services.splice(0)) await s.close()
    for (const t of trees.splice(0)) t.cleanup()
  })

  interface Setup {
    tree: ReturnType<typeof tempTree>
    service: LibraryService
    lib: LibraryInfo
    fingerprint: ReturnType<typeof vi.fn>
    events: LibraryEvent[]
    scans: () => number
  }

  const setup = async (storage: LibraryStorage): Promise<Setup> => {
    const tree = tempTree()
    trees.push(tree)
    tree.write('A (2001)/A (2001).mkv', Buffer.alloc(150_003, 1))
    ageTree(tree.root)
    const fingerprint = vi.fn(async () => 'abcdef0123456789')
    const events: LibraryEvent[] = []
    const service = new LibraryService({
      dbPath: ':memory:',
      watchMode: 'poll',
      scanIntervalMs: 50,
      notifyQuietMs: 30,
      fingerprint,
      detectFs: async () => undefined,
    })
    services.push(service)
    service.subscribe(e => events.push(e))
    await service.start()
    const lib = await service.addLibrary({
      root: tree.root,
      kind: 'movie',
      automation: { identify: false, storage },
    })
    await service.queue.idle()
    await service.queue.idle()
    const scans = (): number =>
      events.filter(
        e => e.type === 'job' && e.jobType === 'scan' && e.state === 'queued'
      ).length
    return { tree, service, lib, fingerprint, events, scans }
  }

  /** 等条件成立（满载机器上计时器会晚），最多 5 秒。 */
  const waitFor = async (ok: () => boolean): Promise<void> => {
    for (let t = 0; t < 5000 && !ok(); t += 20)
      await new Promise(r => setTimeout(r, 20))
  }

  const titles = (service: LibraryService): string[] =>
    service
      .query(normalizeLibraryQuery({}))
      .items.map(i => i.title)
      .sort()

  it('网盘：首扫入库但不算指纹；之后不定时扫描；通知到了按目录扫描入库', async () => {
    const { tree, service, lib, fingerprint, scans, events } =
      await setup('cloud')
    expect(titles(service)).toEqual(['A'])
    expect(fingerprint).not.toHaveBeenCalled()
    const fingerprintJobs = (): number =>
      events.filter(e => e.type === 'job' && e.jobType === 'fingerprint').length
    expect(fingerprintJobs()).toBe(0)
    expect(service.listLibraries()[0].cloud).toBe(true)

    const before = scans()
    tree.write('B (2002)/B (2002).mkv', 'b')
    ageTree(tree.root)
    await new Promise(r => setTimeout(r, 300))
    expect(scans()).toBe(before) // 50 ms 一次的定时扫描没有跑

    const result = await handleRpc(service, {
      method: 'notifyChanges',
      params: {
        changes: [
          {
            action: 'create',
            path: join(tree.root, 'B (2002)', 'B (2002).mkv'),
          },
        ],
      },
    })
    expect(result).toEqual({ ok: true, result: { accepted: 1, ignored: 0 } })
    await waitFor(() => titles(service).length === 2)
    expect(titles(service)).toEqual(['A', 'B'])
    expect(fingerprint).not.toHaveBeenCalled()
    expect(fingerprintJobs()).toBe(0)
    expect(lib.automation.storage).toBe('cloud')
  })

  it('网盘：悬停预览不给视频；改成本地盘后给视频、恢复定时扫描与指纹', async () => {
    const { service, lib, fingerprint, scans } = await setup('cloud')
    const itemId = service.query(normalizeLibraryQuery({})).items[0].id
    const preview = await handleRpc(service, {
      method: 'getPreview',
      params: { itemId },
    })
    expect(preview).toMatchObject({ ok: true, result: { video: null } })

    const updated = await service.updateLibrary({
      libraryId: lib.id,
      automation: { storage: 'local' },
    })
    expect(updated.cloud).toBe(false)
    const before = scans()
    await waitFor(() => scans() > before)
    expect(scans()).toBeGreaterThan(before)
    const local = await handleRpc(service, {
      method: 'getPreview',
      params: { itemId },
    })
    expect(local).toMatchObject({
      ok: true,
      result: { video: { fileId: expect.any(Number) } },
    })
    // 改回本地盘：补排指纹任务，算上网盘期间跳过的
    await waitFor(() => fingerprint.mock.calls.length > 0)
    expect(fingerprint).toHaveBeenCalled()
  })

  it('本地盘：照常定时扫描与算指纹；关了「监控文件夹」的库不收通知', async () => {
    const { tree, service, lib, fingerprint, scans } = await setup('local')
    await waitFor(() => fingerprint.mock.calls.length > 0)
    expect(fingerprint).toHaveBeenCalled()
    expect(service.listLibraries()[0].cloud).toBe(false)
    const before = scans()
    await waitFor(() => scans() > before)
    expect(scans()).toBeGreaterThan(before)

    await service.updateLibrary({
      libraryId: lib.id,
      automation: { watch: false },
    })
    expect(
      service.notifyChanges({
        changes: [{ action: 'create', path: join(tree.root, 'x.mkv') }],
      })
    ).toEqual({ accepted: 0, ignored: 1 })
  })
})
