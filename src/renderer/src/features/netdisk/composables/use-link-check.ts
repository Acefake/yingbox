/**
 * 115 分享有效性检测（PanSou /api/check/links，经 pan115.checkLinks）：只测用户真正看到的结果。
 *
 * - 可见区：结果行挂 v-link-check，进入视口（IntersectionObserver）才排队；还没发出就滚走的出队；
 * - 批量：排队后等 {@link GATHER_MS} 攒一批再发，单批不超过 {@link MAX_LINK_CHECKS} 条，满了立即发；
 * - 去重与缓存：按链接缓存结果（ok / bad / locked 缓存 {@link CHECK_TTL_MS}，没测出来的 unknown 缓存
 *   {@link UNKNOWN_TTL_MS}），在测的链接共用同一个请求（in-flight 合并）；
 * - 节流显示：结果先进待提交区，最多每 {@link FLUSH_MS} 提交一次到界面，失效行沉底时列表不会一条条跳；
 * - 转存前：{@link LinkCheck.guardReceive} 先查一次（有缓存直接用），确认失效才拦下，其余照常转存；
 * - 静默：IPC 拒绝、超时、报错都当作 unknown；实例不支持时按实例地址记住，本页不再请求。
 */
import {
  type ObjectDirective,
  getCurrentScope,
  onScopeDispose,
  shallowRef,
} from 'vue'

import type { Api } from '../../../../../shared/contract'
import {
  type LinkCheckItem,
  type LinkCheckReply,
  type LinkCheckState,
  MAX_LINK_CHECKS,
} from '../../../../../shared/contract/pan115'

/** 有效 / 失效 / 需提取码 的缓存时长 */
export const CHECK_TTL_MS = 30 * 60_000
/** 没测出来（超时、报错、平台不支持）的缓存时长，过后再进视口会重测 */
export const UNKNOWN_TTL_MS = 5 * 60_000
/** 结果提交到界面的最小间隔 */
export const FLUSH_MS = 300
/** 排队后攒批的等待时间 */
export const GATHER_MS = 120
/** 转存前确认失效时的提示 */
export const DEAD_SHARE = '这个分享已失效，换一条试试'

type CheckApi = Pick<Api['pan115'], 'checkLinks'>
type ReceiveApi = Pick<Api['pan115'], 'snap' | 'receive'>

/** 依赖 */
export interface LinkCheckDeps {
  api: () => CheckApi
  /** 当前 PanSou 地址（记住「不支持」用的键；换了地址会重新尝试） */
  instance?: () => string
  /** 当前时间（测试注入） */
  now?: () => number
}

/** 检测状态与动作 */
export interface LinkCheck {
  /** 已提交到界面的状态；没测过时为 undefined */
  stateOf(url: string): LinkCheckState | undefined
  /** 排队检测一条（去重、攒批）；已缓存或在测时什么都不做 */
  enqueue(item: LinkCheckItem): void
  /** 立即取一条的状态（缓存 → 在测的请求 → 单独发一批），不会 reject */
  check(item: LinkCheckItem): Promise<LinkCheckState>
  /** 稳定排序：失效的放到最后，其余保持原顺序 */
  order<T extends { url: string }>(rows: T[]): T[]
  /** 包一层 pan115：receive 前先检测，确认失效时直接返回失败 */
  guardReceive(api: () => ReceiveApi): () => ReceiveApi
  /** 结果行的指令：v-link-check="{ url, receiveCode }"，进入视口时排队检测 */
  vLinkCheck: ObjectDirective<HTMLElement, VisibleShare>
  /** 停掉观察与计时器（组件作用域销毁时自动调用） */
  dispose(): void
}

/** 指令的值：搜索结果里的一条 115 分享 */
export interface VisibleShare {
  url: string
  receiveCode: string
}

interface Cached {
  state: LinkCheckState
  at: number
}

/** 创建检测器（一个页面一个） */
export function useLinkCheck(deps: LinkCheckDeps): LinkCheck {
  const now = deps.now ?? Date.now
  const instance = (): string => deps.instance?.().trim() ?? ''
  const cache = new Map<string, Cached>()
  const inflight = new Map<string, Promise<LinkCheckState>>()
  const queue = new Map<string, LinkCheckItem>()
  const unsupported = new Set<string>()
  const committed = shallowRef<ReadonlyMap<string, LinkCheckState>>(new Map())
  const pending = new Map<string, LinkCheckState>()
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let gatherTimer: ReturnType<typeof setTimeout> | undefined

  const disabled = (): boolean => unsupported.has(instance())

  /** 未过期的缓存 */
  function fresh(url: string): Cached | undefined {
    const hit = cache.get(url)
    if (!hit) return undefined
    const ttl = hit.state === 'unknown' ? UNKNOWN_TTL_MS : CHECK_TTL_MS
    return now() - hit.at < ttl ? hit : undefined
  }

  /** 待提交的结果一次性写到界面 */
  function flush(): void {
    flushTimer = undefined
    if (!pending.size) return
    const next = new Map(committed.value)
    for (const [url, state] of pending) next.set(url, state)
    pending.clear()
    committed.value = next
  }

  function record(url: string, state: LinkCheckState): void {
    cache.set(url, { state, at: now() })
    pending.set(url, state)
    flushTimer ??= setTimeout(flush, FLUSH_MS)
  }

  /** 发一批；返回的 Promise 不会 reject。实例不支持时不记结果 */
  function send(items: LinkCheckItem[]): void {
    const key = instance()
    // 只传纯字符串的新对象，不把响应式对象交给 IPC
    const plain = items.map(({ url, password }) => ({ url, password }))
    const reply: Promise<Map<string, LinkCheckState> | null> = Promise.resolve()
      .then(() => deps.api().checkLinks(plain))
      .catch((): LinkCheckReply => ({ supported: true, results: [] }))
      .then(result => {
        if (!result.supported) {
          unsupported.add(key)
          return null
        }
        return new Map(result.results.map(r => [r.url, r.state]))
      })
    for (const { url } of plain) {
      inflight.set(
        url,
        reply.then(states => {
          inflight.delete(url)
          if (!states) return 'unknown'
          const state = states.get(url) ?? 'unknown'
          record(url, state)
          return state
        })
      )
    }
  }

  /** 把队列按单批上限发出去 */
  function drain(): void {
    if (gatherTimer) clearTimeout(gatherTimer)
    gatherTimer = undefined
    if (disabled()) return queue.clear()
    while (queue.size) {
      const batch = [...queue.values()].slice(0, MAX_LINK_CHECKS)
      for (const item of batch) queue.delete(item.url)
      send(batch)
    }
  }

  function enqueue(item: LinkCheckItem): void {
    const { url } = item
    if (!url || disabled() || fresh(url) || inflight.has(url)) return
    queue.set(url, { url, password: item.password })
    if (queue.size >= MAX_LINK_CHECKS) drain()
    else gatherTimer ??= setTimeout(drain, GATHER_MS)
  }

  async function check(item: LinkCheckItem): Promise<LinkCheckState> {
    const hit = fresh(item.url)
    if (hit) return hit.state
    const running = inflight.get(item.url)
    if (running) return running
    if (disabled()) return 'unknown'
    queue.delete(item.url)
    send([{ url: item.url, password: item.password }])
    return inflight.get(item.url) ?? 'unknown'
  }

  function order<T extends { url: string }>(rows: T[]): T[] {
    const states = committed.value
    const dead = (row: T): boolean => states.get(row.url) === 'bad'
    if (!rows.some(dead)) return rows
    return [...rows.filter(row => !dead(row)), ...rows.filter(dead)]
  }

  function guardReceive(api: () => ReceiveApi): () => ReceiveApi {
    return () => {
      const base = api()
      return {
        snap: (url, password) => base.snap(url, password),
        // 目标文件夹等其余参数原样转给 receive
        receive: async (...args) =>
          (await check({ url: args[0], password: args[1] })) === 'bad'
            ? { ok: false, error: DEAD_SHARE }
            : base.receive(...args),
      }
    }
  }

  // —— 可见区观察 ——
  const watched = new WeakMap<Element, LinkCheckItem>()
  let observer: IntersectionObserver | null = null

  function getObserver(): IntersectionObserver | null {
    if (observer || typeof IntersectionObserver === 'undefined') return observer
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const item = watched.get(entry.target)
        if (!item) continue
        if (entry.isIntersecting) enqueue(item)
        else queue.delete(item.url)
      }
    })
    return observer
  }

  function observe(el: HTMLElement, share: VisibleShare): void {
    watched.set(el, { url: share.url, password: share.receiveCode })
    getObserver()?.observe(el)
  }

  function unobserve(el: HTMLElement): void {
    const item = watched.get(el)
    if (item) queue.delete(item.url)
    watched.delete(el)
    observer?.unobserve(el)
  }

  const vLinkCheck: ObjectDirective<HTMLElement, VisibleShare> = {
    mounted: (el, { value }) => observe(el, value),
    updated(el, { value, oldValue }) {
      if (value.url === oldValue?.url) return
      unobserve(el)
      observe(el, value)
    },
    beforeUnmount: el => unobserve(el),
  }

  function dispose(): void {
    observer?.disconnect()
    observer = null
    if (gatherTimer) clearTimeout(gatherTimer)
    if (flushTimer) clearTimeout(flushTimer)
    gatherTimer = flushTimer = undefined
    queue.clear()
  }

  if (getCurrentScope()) onScopeDispose(dispose)

  return {
    stateOf: url => committed.value.get(url),
    enqueue,
    check,
    order,
    guardReceive,
    vLinkCheck,
    dispose,
  }
}
