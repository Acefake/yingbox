/**
 * actor-profile 任务：为演员查资料、合并写回、缓存头像。低优先级、可取消，不阻塞影片入库。
 *
 * - auto：只查待查的演员（新出现的，或上次全部来源失败且过了重试间隔）；
 * - refresh：用户手动刷新，先让这些演员的来源缓存过期再查。
 * 同一批里一位演员只查一次（id 去重；名字归一后同名即同一行，见 ActorStore.ensure）。
 * 每个来源的结果按「来源 + 名字」缓存在 provider_cache：查到 7 天、查无此人 1 天，出错不缓存。
 */
import type { ActorSettings } from '../../../shared/library/ipc'
import { type LibraryDb, transaction } from '../db/database'
import type { JobContext } from '../jobs/queue'
import type { ResponseCache } from '../providers/http/provider-cache'
import {
  type ActorContext,
  type ActorProfile,
  type ActorSource,
  lookupActor,
} from '../providers/jav/actors'
import {
  ACTOR_RETRY_MS,
  ACTOR_TTL,
  type ActorRecord,
  actorCacheKey,
  lookupState,
  mergeOrder,
  mergeProfile,
  pickSources,
} from './actor-rules'
import type { ActorStore } from './actor-store'

/** 任务载荷；actorIds 缺省时 auto 查全部待查的、refresh 查全部有作品的。 */
export interface ActorJobPayload {
  mode: 'auto' | 'refresh'
  actorIds?: number[]
}

/** 排队键：同一模式的任务合并。 */
export const actorJobKey = (mode: ActorJobPayload['mode']): string =>
  `actor-profile:${mode}`

/** 合并两个排队中的载荷：任一方是「全部」就是全部，否则 id 取并集。 */
export function mergeActorPayload(a: unknown, b: unknown): ActorJobPayload {
  const x = a as ActorJobPayload
  const y = b as ActorJobPayload
  if (!x.actorIds || !y.actorIds) return { mode: x.mode }
  return {
    mode: x.mode,
    actorIds: [...new Set([...x.actorIds, ...y.actorIds])],
  }
}

/** 带过期清理的响应缓存（SqliteResponseCache 满足）。 */
export type ActorCache = ResponseCache & {
  expire(prefixes: string[], now: number): void
}

/** 给来源包一层缓存：命中直接用；查到 / 查无此人写缓存；抛错原样抛出（不缓存）。 */
export function cachedSource(
  source: ActorSource,
  cache: ResponseCache,
  now: () => number
): ActorSource {
  return {
    ...source,
    async fetch(name, ctx) {
      const key = actorCacheKey(source.id, name)
      const hit = cache.get(key)
      if (hit && hit.expiresAt > now())
        return JSON.parse(hit.body) as ActorProfile | null
      const profile = await source.fetch(name, ctx)
      const at = now()
      cache.set(
        key,
        {
          body: JSON.stringify(profile),
          etag: null,
          expiresAt: at + (profile ? ACTOR_TTL.found : ACTOR_TTL.missing),
        },
        at
      )
      return profile
    },
  }
}

/** 任务需要的模块能力。 */
export interface ActorJobDeps {
  db: LibraryDb
  store: ActorStore
  cache: ActorCache
  /** 全部内置来源。 */
  sources: () => readonly ActorSource[]
  settings: () => ActorSettings
  /** 取页上下文（熔断、限速、防护页识别与番号站点共用）。 */
  context: (signal: AbortSignal) => ActorContext
  /** 头像缓存；没有时 photo 存远程地址。 */
  images?: {
    ensure(
      urls: string[],
      signal?: AbortSignal
    ): Promise<Map<string, string | null>>
  }
  /** 一批演员资料变化（节流推送）。 */
  emit: (actorIds: number[]) => void
  /** 同时查的演员数，默认 3。 */
  concurrency?: number
  now?: () => number
  log?: (message: string) => void
}

/** 变化推送最小间隔。 */
const EMIT_INTERVAL_MS = 500

/** auto 模式下这位演员是否该查。 */
function isDue(rec: ActorRecord, now: number): boolean {
  return (
    rec.profileState === 'pending' ||
    (rec.profileState === 'error' &&
      (rec.profileAt ?? 0) < now - ACTOR_RETRY_MS)
  )
}

/** 首选头像：能缓存就换成 yingbox-media 地址，否则用远程地址。 */
async function photoOf(
  deps: ActorJobDeps,
  url: string | undefined,
  signal: AbortSignal
): Promise<string | null> {
  if (!url) return null
  if (!deps.images) return url
  return (await deps.images.ensure([url], signal)).get(url) ?? url
}

/** 查一位演员并写回；返回是否写了库。 */
async function refreshOne(
  deps: ActorJobDeps,
  rec: ActorRecord,
  settings: ActorSettings,
  signal: AbortSignal
): Promise<boolean> {
  const now = deps.now ?? Date.now
  const picked = pickSources(deps.sources(), settings, rec.gender)
  if (!picked.length) return false
  const sources = picked.map(s => cachedSource(s, deps.cache, now))
  const lookup = await lookupActor(rec.name, {
    sources,
    ctx: deps.context(signal),
    order: mergeOrder(picked),
  })
  for (const f of lookup.failures) {
    deps.log?.(
      `演员资料 ${f.source} 查询「${rec.name}」失败：${(f.error as Error)?.message ?? f.error}`
    )
  }
  const merged = mergeProfile(rec, lookup.actor)
  const photo = await photoOf(deps, merged.values.images[0], signal)
  signal.throwIfAborted()
  let written = false
  transaction(deps.db, () => {
    if (!deps.store.exists(rec.id)) return
    deps.store.writeProfile(rec.id, rec.name, merged, {
      photo,
      state: lookupState(lookup),
      now: now(),
    })
    written = true
  })
  return written
}

/** 执行一个 actor-profile 任务。 */
export async function runActorJob(
  deps: ActorJobDeps,
  payload: ActorJobPayload,
  ctx: JobContext
): Promise<void> {
  const now = deps.now ?? Date.now
  const ids = [
    ...new Set(
      payload.actorIds ??
        (payload.mode === 'auto'
          ? deps.store.pendingIds(now())
          : deps.store.linkedIds())
    ),
  ]
  if (!ids.length) return
  const settings = deps.settings()
  if (payload.mode === 'refresh') {
    const keys = ids.flatMap(id => {
      const rec = deps.store.record(id)
      return rec ? settings.sources.map(s => actorCacheKey(s.id, rec.name)) : []
    })
    deps.cache.expire(keys, now())
  }
  let pending: number[] = []
  let lastEmit = 0
  const flush = (force: boolean): void => {
    if (!pending.length || (!force && now() - lastEmit < EMIT_INTERVAL_MS))
      return
    lastEmit = now()
    deps.emit(pending)
    pending = []
  }
  let next = 0
  let done = 0
  const worker = async (): Promise<void> => {
    while (next < ids.length) {
      ctx.signal.throwIfAborted()
      const rec = deps.store.record(ids[next++])
      if (rec && (payload.mode === 'refresh' || isDue(rec, now()))) {
        if (await refreshOne(deps, rec, settings, ctx.signal)) {
          pending.push(rec.id)
          flush(false)
        }
      }
      ctx.progress(++done / ids.length)
    }
  }
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(deps.concurrency ?? 3, ids.length) },
        worker
      )
    )
  } finally {
    flush(true)
  }
}
