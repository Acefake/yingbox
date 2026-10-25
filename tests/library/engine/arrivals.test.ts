/**
 * 新入库：水位游标的纯规则，以及真实片库（内存库、临时目录）里扫描后宣布新电影 / 新集、同一条只宣布一次、
 * 识别迟迟不来时等宽限期。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ARRIVAL_GRACE_MS,
  type ArrivalRow,
  parseCursor,
  planArrivals,
} from '../../../src/main/library/arrivals/arrival-rules'
import { ArrivalsModule } from '../../../src/main/library/arrivals/arrivals-module'
import { LibraryService } from '../../../src/main/library/engine/service'
import { tempTree } from './helpers'

const row = (
  itemId: number,
  addedAt: number,
  identifiedAt: number | null = null,
  libraryId = 1
): ArrivalRow => ({ itemId, libraryId, addedAt, identifiedAt })

describe('planArrivals', () => {
  const always = (): boolean => true

  it('识别过的宣布、没识别的等着，水位停在最早一个要等的之前', () => {
    const plan = planArrivals(
      [row(1, 100, 150), row(2, 110, null), row(3, 120, 130)],
      { since: 50, announced: [] },
      200,
      always
    )
    expect(plan.ready.map(r => r.itemId)).toEqual([1, 3])
    // 1 在水位之前，下一轮不会再查到它，不用记
    expect(plan.cursor).toEqual({ since: 109, announced: [[3, 120]] })
    expect(plan.recheckAt).toBe(110 + ARRIVAL_GRACE_MS)
  })

  it('已宣布的不再宣布；没有要等的时水位推到最新、清空已宣布', () => {
    const cursor = {
      since: 109,
      announced: [[3, 120]] as Array<[number, number]>,
    }
    const plan = planArrivals(
      [row(2, 110, 300), row(3, 120, 130)],
      cursor,
      400,
      always
    )
    expect(plan.ready.map(r => r.itemId)).toEqual([2])
    expect(plan.cursor).toEqual({ since: 120, announced: [] })
    expect(plan.recheckAt).toBeNull()
  })

  it('库没开自动识别直接宣布；识别早于入库（老剧来了新集）要等新的识别', () => {
    expect(
      planArrivals([row(1, 100)], { since: 0, announced: [] }, 101, () => false)
        .ready
    ).toHaveLength(1)
    expect(
      planArrivals([row(1, 100, 90)], { since: 0, announced: [] }, 101, always)
        .ready
    ).toHaveLength(0)
  })

  it('入库满宽限期照常宣布', () => {
    const plan = planArrivals(
      [row(1, 100)],
      { since: 0, announced: [] },
      100 + ARRIVAL_GRACE_MS,
      always
    )
    expect(plan.ready).toHaveLength(1)
  })

  it('坏游标从现在开始', () => {
    expect(parseCursor('{"since":"x"}', 42)).toEqual({
      since: 42,
      announced: [],
    })
    expect(parseCursor(undefined, 7)).toEqual({ since: 7, announced: [] })
    expect(
      parseCursor('{"since":5,"announced":[[1,6],["a",2],[3]]}', 0)
    ).toEqual({ since: 5, announced: [[1, 6]] })
  })
})

describe('ArrivalsModule（真实片库）', () => {
  let tree: ReturnType<typeof tempTree>
  const services: LibraryService[] = []
  const modules: ArrivalsModule[] = []
  beforeEach(() => {
    tree = tempTree()
  })
  afterEach(async () => {
    for (const m of modules.splice(0)) m.close()
    for (const s of services.splice(0)) await s.close()
    tree.cleanup()
  })

  async function setup(
    autoIdentify: boolean,
    clock: { now: number }
  ): Promise<{
    service: LibraryService
    arrivals: ArrivalsModule
    delivered: string[]
  }> {
    const service = new LibraryService({ dbPath: ':memory:', watch: false })
    services.push(service)
    await service.start()
    const delivered: string[] = []
    const arrivals = new ArrivalsModule({
      db: service.db,
      subscribe: listener => service.subscribe(listener),
      autoIdentify: () => autoIdentify,
      deliver: list =>
        delivered.push(
          ...list.map(a =>
            a.kind === 'movie'
              ? `movie ${a.title} ${a.year}`
              : `ep ${a.title} S${a.season}E${a.episode}`
          )
        ),
      now: () => clock.now,
    })
    modules.push(arrivals)
    arrivals.start()
    return { service, arrivals, delivered }
  }

  it('打开之前就入库的不宣布（水位定在打开那一刻）', async () => {
    const { service, arrivals, delivered } = await setup(false, {
      now: Date.now() + 60_000,
    })
    tree.write('Dune (2021)/Dune (2021).mkv')
    await service.addLibrary({
      root: tree.root,
      kind: 'movie',
      automation: { identify: false },
    })
    await service.queue.idle()
    expect(arrivals.sweep()).toEqual([])
    expect(delivered).toEqual([])
  })

  it('打开之后入库的：宣布电影与集（集带剧名和季集），再扫一轮不重复', async () => {
    const clock = { now: Date.now() - 1000 }
    const { service, arrivals, delivered } = await setup(false, clock)
    tree.write('Dune (2021)/Dune (2021).mkv')
    const tv = tempTree()
    try {
      tv.write('Severance/Season 1/Severance S01E02.mkv')
      await service.addLibrary({
        root: tree.root,
        kind: 'movie',
        automation: { identify: false },
      })
      await service.addLibrary({
        root: tv.root,
        kind: 'tv',
        automation: { identify: false },
      })
      await service.queue.idle()
      clock.now = Date.now() + 1000
      arrivals.sweep()
      expect(delivered.sort()).toEqual(['ep Severance S1E2', 'movie Dune 2021'])
      expect(arrivals.sweep()).toEqual([])
    } finally {
      tv.cleanup()
    }
  })

  it('库开着自动识别、还没识别：等宽限期到了才宣布', async () => {
    const clock = { now: Date.now() - 1000 }
    const { service, arrivals, delivered } = await setup(true, clock)
    tree.write('Dune (2021)/Dune (2021).mkv')
    await service.addLibrary({
      root: tree.root,
      kind: 'movie',
      automation: { identify: false },
    })
    await service.queue.idle()
    clock.now = Date.now() + 1000
    expect(arrivals.sweep()).toEqual([])
    clock.now += ARRIVAL_GRACE_MS
    expect(arrivals.sweep().map(a => a.title)).toEqual(['Dune'])
    expect(delivered).toEqual(['movie Dune 2021'])
  })
})
