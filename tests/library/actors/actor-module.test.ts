/**
 * 演员库模块与 actor-profile 任务：识别后同步并自动查资料（同批去重）、来源缓存（查到 / 查无 / 失败不缓存）、
 * 手动刷新忽略缓存、取消、锁定字段不被覆盖、按性别选来源、来源开关、手动编辑。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { ActorModule } from '../../../src/main/library/actors/actor-module'
import { mergeActorPayload } from '../../../src/main/library/actors/actor-job'
import { JobStore } from '../../../src/main/library/jobs/job-store'
import { JobQueue } from '../../../src/main/library/jobs/queue'
import type { JavProvider } from '../../../src/main/library/providers/jav/jav-provider'
import type { ActorSource } from '../../../src/main/library/providers/jav/actors'
import {
  DEFAULT_ACTOR_SETTINGS,
  type LibraryEvent,
  parseActorQuery,
} from '../../../src/shared/library/ipc'
import { addMovie, fakeSource, memoryDb } from './helpers'

const stops: Array<() => Promise<void>> = []
afterEach(async () => {
  while (stops.length) await stops.pop()!()
})

interface Env {
  db: ReturnType<typeof memoryDb>['db']
  libraryId: number
  queue: JobQueue
  events: LibraryEvent[]
  actors: ActorModule
  idOf: (name: string) => number
}

function setup(sources: ActorSource[]): Env {
  const { db, libraryId } = memoryDb()
  const queue = new JobQueue(new JobStore(db), { concurrency: 2 })
  const events: LibraryEvent[] = []
  const actors = new ActorModule({
    db,
    queue,
    emit: e => events.push(e),
    identify: () => ({
      jav: {
        actorContext: (signal?: AbortSignal) => ({
          signal,
          page: async () => null,
        }),
      } as unknown as JavProvider,
      images: undefined,
      javCredentials: () => ({}),
    }),
    sources,
  })
  actors.start()
  queue.start()
  stops.push(() => queue.stop())
  const idOf = (name: string): number =>
    actors
      .list(parseActorQuery({ search: name }))
      .items.find(a => a.name === name)!.id
  return { db, libraryId, queue, events, actors, idOf }
}

describe('演员库模块', () => {
  it('识别后同步关联、自动查资料；同批同名只查一次；头像与资料聚合写回', async () => {
    const avbase = fakeSource('avbase', {
      Mia: { birthday: '1993-08-16', height: 160, aliases: ['みあ'] },
    })
    const gfriends = fakeSource(
      'gfriends',
      { Mia: { images: ['https://g/mia.jpg'] } },
      { capability: 'image', genders: ['female'] }
    )
    const env = setup([gfriends, avbase])
    const a = addMovie(env.db, env.libraryId, 'A-1', ['Mia', 'Nobody'])
    const b = addMovie(env.db, env.libraryId, 'A-2', ['Mia'])
    env.actors.onIdentified([a, b])
    await env.queue.idle()
    expect(avbase.calls.sort()).toEqual(['Mia', 'Nobody'])
    expect(gfriends.calls.sort()).toEqual(['Mia', 'Nobody'])
    const mia = env.actors.get(env.idOf('Mia'))!
    expect(mia).toMatchObject({
      workCount: 2,
      birthday: '1993-08-16',
      height: 160,
      aliases: ['みあ'],
      images: ['https://g/mia.jpg'],
      photo: 'https://g/mia.jpg',
      profileState: 'found',
      fieldSources: { birthday: 'avbase', images: 'gfriends' },
    })
    expect(env.actors.get(env.idOf('Nobody'))!.profileState).toBe('missing')
    expect(env.events.some(e => e.type === 'actors-changed')).toBe(true)
  })

  it('缓存：查到 / 查无此人的结果复用；手动刷新忽略缓存；失败不缓存且下次再查', async () => {
    const blocked = new Set(['Mia'])
    const src = fakeSource(
      'avbase',
      { Mia: { height: 150 } },
      { throws: blocked }
    )
    const env = setup([src])
    const a = addMovie(env.db, env.libraryId, 'A-1', ['Mia', 'Ghost'])
    env.actors.onIdentified([a])
    await env.queue.idle()
    const mia = env.idOf('Mia')
    expect(env.actors.get(mia)!.profileState).toBe('error')
    const cached = env.db
      .prepare("SELECT key FROM provider_cache WHERE key LIKE 'actor:%'")
      .all()
      .map(r => String(r.key))
    expect(cached).toEqual(['actor:avbase:Ghost'])

    blocked.clear()
    src.calls.length = 0
    env.actors.refresh({ actorIds: [mia] })
    await env.queue.idle()
    expect(src.calls).toEqual(['Mia'])
    expect(env.actors.get(mia)).toMatchObject({
      profileState: 'found',
      height: 150,
    })

    // 再刷新一次全部：缓存过期后重查
    src.calls.length = 0
    env.actors.refresh({})
    await env.queue.idle()
    expect(src.calls.sort()).toEqual(['Ghost', 'Mia'])
    // 自动任务不会重查已有结论的演员
    src.calls.length = 0
    env.actors.onIdentified([a])
    await env.queue.idle()
    expect(src.calls).toEqual([])
  })

  it('锁定字段不被刷新覆盖；手动编辑记为用户来源', async () => {
    const src = fakeSource('avbase', {
      Mia: { height: 150, cup: 'C', overview: '简介' },
    })
    const env = setup([src])
    addMovie(env.db, env.libraryId, 'A-1', ['Mia'])
    env.actors.onIdentified([1])
    await env.queue.idle()
    const id = env.idOf('Mia')
    const edited = await env.actors.update({
      actorId: id,
      values: { height: 158, aliases: ['Mia', 'みあ'] },
      lockedFields: ['height'],
    })
    expect(edited).toMatchObject({
      height: 158,
      aliases: ['みあ'],
      lockedFields: ['height'],
      fieldSources: { height: 'user', aliases: 'user', cup: 'avbase' },
    })
    env.actors.refresh({ actorIds: [id] })
    await env.queue.idle()
    expect(env.actors.get(id)).toMatchObject({
      height: 158,
      cup: 'C',
      overview: '简介',
    })
  })

  it('取消：运行中的任务被中断，结果不写库', async () => {
    let release!: () => void
    const started: string[] = []
    const src = fakeSource(
      'avbase',
      { Mia: { height: 150 } },
      {
        wait: signal =>
          new Promise<void>((resolve, reject) => {
            started.push('x')
            release = resolve
            signal?.addEventListener('abort', () => reject(signal.reason))
          }),
      }
    )
    const env = setup([src])
    addMovie(env.db, env.libraryId, 'A-1', ['Mia'])
    env.actors.onIdentified([1])
    for (let i = 0; i < 50 && !started.length; i++)
      await new Promise(r => setTimeout(r, 5))
    expect(env.actors.cancelRefresh().cancelled).toBe(1)
    await env.queue.idle()
    release?.()
    expect(env.actors.get(env.idOf('Mia'))!.profileState).toBe('pending')
    const state = env.db
      .prepare("SELECT state FROM jobs WHERE type = 'actor-profile'")
      .get()!.state
    expect(state).toBe('cancelled')
  })

  it('按性别与开关选来源：只收女优的来源不查男优；关掉的来源不查；关掉自动查资料就不排任务', async () => {
    const female = fakeSource('minnano', {}, { genders: ['female'] })
    const both = fakeSource('wikipedia', {})
    const env = setup([female, both])
    addMovie(env.db, env.libraryId, 'A-1', ['Ken'])
    env.actors.onIdentified([1])
    await env.queue.idle()
    const id = env.idOf('Ken')
    await env.actors.update({
      actorId: id,
      values: { gender: 'male' },
      lockedFields: ['gender'],
    })
    female.calls.length = 0
    both.calls.length = 0
    env.actors.refresh({ actorIds: [id] })
    await env.queue.idle()
    expect(female.calls).toEqual([])
    expect(both.calls).toEqual(['Ken'])

    env.actors.setSettings({
      sources: DEFAULT_ACTOR_SETTINGS.sources.map(s => ({
        ...s,
        enabled: s.id !== 'wikipedia',
      })),
      autoLookup: false,
    })
    both.calls.length = 0
    addMovie(env.db, env.libraryId, 'A-2', ['New'])
    env.actors.onIdentified([2])
    await env.queue.idle()
    expect(
      env.db
        .prepare(
          "SELECT COUNT(*) AS n FROM jobs WHERE type = 'actor-profile' AND state = 'queued'"
        )
        .get()!.n
    ).toBe(0)
    env.actors.refresh({ actorIds: [id] })
    await env.queue.idle()
    expect(both.calls).toEqual([])
  })

  it('排队载荷合并：任一方为全部即全部，否则 id 并集', () => {
    expect(
      mergeActorPayload(
        { mode: 'refresh', actorIds: [1] },
        { mode: 'refresh', actorIds: [2, 1] }
      )
    ).toEqual({
      mode: 'refresh',
      actorIds: [1, 2],
    })
    expect(
      mergeActorPayload({ mode: 'refresh', actorIds: [1] }, { mode: 'refresh' })
    ).toEqual({ mode: 'refresh' })
  })
})
