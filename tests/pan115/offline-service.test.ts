/**
 * 离线下载模块：添加记下任务、没有要跟进的任务时不查 115、同步进度、完成后按 115 路径通知入库（失败下一轮再试）、
 * 列表里找不到的任务记失败、落盘读回、未登录引导。
 */
import { describe, expect, it, vi } from 'vitest'

import type { OfflineAddItem } from '../../src/shared/contract/offline'
import { Pan115Error } from '../../src/main/pan115/errors'
import type { RawOfflineTask } from '../../src/main/pan115/offline'
import {
  MIN_SYNC_GAP_MS,
  MISSING_AFTER_MS,
  type OfflineState,
  createOfflineService,
  parseOfflineState,
} from '../../src/main/offline/service'

const HASH = 'a'.repeat(40)
const LINK = `magnet:?xt=urn:btih:${HASH}&dn=Some.Movie.2024&xl=2048`

function raw(patch: Partial<RawOfflineTask> = {}): RawOfflineTask {
  return {
    hash: HASH,
    name: 'Some.Movie.2024',
    size: 2048,
    percent: 40,
    status: 'running',
    addedAt: 0,
    folderCid: '777',
    fileId: '9',
    ...patch,
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- 测试助手，返回值由推导得出
function setup(options: { loggedIn?: boolean; saved?: unknown } = {}) {
  let now = 1_000_000
  let tasks: RawOfflineTask[] = []
  let saved: OfflineState | null = null
  const pan = {
    loggedIn: vi.fn(async () => options.loggedIn ?? true),
    add: vi.fn(
      async (links: readonly string[]): Promise<OfflineAddItem[]> =>
        links.map(link => ({
          link,
          ok: true,
          existed: false,
          hash: HASH,
          name: '',
        }))
    ),
    list: vi.fn(async () => ({ tasks, pageCount: 1 })),
    dirPath: vi.fn(async () => ['电影', '新片']),
  }
  const notify = vi.fn(async (_path: string) => {})
  const emit = vi.fn()
  const service = createOfflineService({
    pan,
    folder: () => ({ cid: '777', name: '新片' }),
    notify,
    load: async () => options.saved ?? null,
    save: async state => {
      saved = JSON.parse(JSON.stringify(state))
    },
    now: () => now,
    emit,
    log: () => {},
  })
  return {
    service,
    pan,
    notify,
    emit,
    saved: () => saved,
    setTasks: (next: RawOfflineTask[]) => (tasks = next),
    advance: (ms: number) => (now += ms),
  }
}

describe('离线下载服务', () => {
  it('未登录：添加返回 setup=login，不调 115', async () => {
    const t = setup({ loggedIn: false })
    expect(await t.service.add([LINK])).toEqual({
      ok: false,
      error: expect.stringContaining('扫码登录'),
      setup: 'login',
    })
    expect(t.pan.add).not.toHaveBeenCalled()
  })

  it('添加：存到转存目标文件夹，记下任务（名字 / 大小取自链接）并推送 changed', async () => {
    const t = setup()
    const result = await t.service.add([LINK])
    expect(result).toMatchObject({ ok: true, folder: '新片' })
    expect(t.pan.add).toHaveBeenCalledWith([LINK], '777')
    expect(t.saved()?.tasks).toEqual([
      expect.objectContaining({
        hash: HASH,
        link: LINK,
        name: 'Some.Movie.2024',
        size: 2048,
        status: 'waiting',
        cid: '777',
        folder: '新片',
        imported: false,
      }),
    ])
    expect(t.emit).toHaveBeenCalled()
    // 同一个任务再加不重复记
    await t.service.add([LINK])
    expect(t.saved()?.tasks).toHaveLength(1)
  })

  it('添加失败（115 报错）原样转人话，不记任务', async () => {
    const t = setup()
    t.pan.add.mockRejectedValueOnce(new Pan115Error('本月离线配额已用完'))
    expect(await t.service.add([LINK])).toEqual({
      ok: false,
      error: '本月离线配额已用完',
    })
    expect(t.saved()).toBeNull()
  })

  it('没有要跟进的任务时，定时一轮不查 115', async () => {
    const t = setup()
    await t.service.tick()
    expect(t.pan.list).not.toHaveBeenCalled()
    expect(t.pan.loggedIn).not.toHaveBeenCalled()
  })

  it('同步进度；完成后按「保存目录路径 / 任务名」通知入库一次，之后不再查', async () => {
    const t = setup()
    await t.service.add([LINK])
    t.setTasks([raw()])
    await t.service.tick()
    expect(t.saved()?.tasks[0]).toMatchObject({
      status: 'running',
      percent: 40,
    })
    expect(t.notify).not.toHaveBeenCalled()

    t.setTasks([
      raw({ status: 'done', percent: 99, name: 'Some.Movie.2024.2160p' }),
    ])
    await t.service.tick()
    expect(t.pan.dirPath).toHaveBeenCalledWith('777')
    expect(t.notify).toHaveBeenCalledWith('/电影/新片/Some.Movie.2024.2160p')
    expect(t.saved()?.tasks[0]).toMatchObject({
      status: 'done',
      percent: 100,
      imported: true,
    })

    t.pan.list.mockClear()
    await t.service.tick()
    expect(t.pan.list).not.toHaveBeenCalled()
    expect(t.notify).toHaveBeenCalledTimes(1)
  })

  it('通知入库失败时保留未入库，下一轮再试', async () => {
    const t = setup()
    await t.service.add([LINK])
    t.setTasks([raw({ status: 'done' })])
    t.notify.mockRejectedValueOnce(new Error('片库没开'))
    await t.service.tick()
    expect(t.saved()?.tasks[0]).toMatchObject({
      status: 'done',
      imported: false,
    })
    await t.service.tick()
    expect(t.notify).toHaveBeenCalledTimes(2)
    expect(t.saved()?.tasks[0].imported).toBe(true)
  })

  it('115 失败带原因；列表翻完找不到、添加超过 10 分钟的记失败', async () => {
    const t = setup()
    await t.service.add([LINK])
    t.setTasks([])
    await t.service.tick()
    expect(t.saved()?.tasks[0].status).toBe('waiting')
    t.advance(MISSING_AFTER_MS + 1)
    await t.service.tick()
    expect(t.saved()?.tasks[0]).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('找不到'),
    })

    const u = setup()
    await u.service.add([LINK])
    u.setTasks([raw({ status: 'failed', error: '资源暂时没有可用的种子' })])
    await u.service.tick()
    expect(u.saved()?.tasks[0]).toMatchObject({
      status: 'failed',
      error: '资源暂时没有可用的种子',
    })
  })

  it('tasks()：有未结束任务时同步（间隔不足 15 秒不重复查），同步失败时带原因、列表照旧', async () => {
    const t = setup()
    await t.service.add([LINK])
    t.setTasks([raw()])
    const first = await t.service.tasks()
    expect(first).toMatchObject({
      loggedIn: true,
      folder: '新片',
      checkedAt: 1_000_000,
    })
    expect(first.tasks[0]).toMatchObject({ status: 'running', percent: 40 })
    expect(first.tasks[0]).not.toHaveProperty('link')
    await t.service.tasks()
    expect(t.pan.list).toHaveBeenCalledTimes(1)

    t.advance(MIN_SYNC_GAP_MS)
    t.pan.list.mockRejectedValueOnce(new Pan115Error('115 云下载 连不上'))
    const failed = await t.service.tasks()
    expect(failed.error).toBe('115 云下载 连不上')
    expect(failed.tasks[0].status).toBe('running')
  })

  it('读回落盘的任务，丢掉坏条目', async () => {
    const good = {
      hash: HASH,
      link: LINK,
      name: 'A',
      size: 0,
      percent: 0,
      status: 'running',
      addedAt: 1,
      cid: '0',
      folder: '',
      imported: false,
    }
    expect(
      parseOfflineState({
        tasks: [good, { hash: 'x' }, null, { ...good, status: 'odd' }],
      }).tasks
    ).toEqual([good])
    expect(parseOfflineState('garbage').tasks).toEqual([])
    const t = setup({ saved: { tasks: [good] } })
    t.setTasks([raw({ status: 'done' })])
    await t.service.tick()
    expect(t.notify).toHaveBeenCalledWith('/电影/新片/Some.Movie.2024')
  })
})
