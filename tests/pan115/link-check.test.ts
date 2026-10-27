/**
 * 渲染层分享有效性检测 useLinkCheck（node 环境、假计时器）：攒批与单批上限、去重、按链接缓存与过期、
 * in-flight 合并、节流提交、失效沉底的稳定排序、实例不支持时静默并记住、转存前拦截失效、可见区观察。
 */
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  CHECK_TTL_MS,
  DEAD_SHARE,
  FLUSH_MS,
  GATHER_MS,
  UNKNOWN_TTL_MS,
  useLinkCheck,
} from '../../src/renderer/src/features/netdisk/composables/use-link-check'
import {
  type LinkCheckItem,
  type LinkCheckReply,
  type LinkCheckState,
  MAX_LINK_CHECKS,
} from '../../src/shared/contract/pan115'

const share = (i: number): LinkCheckItem => ({
  url: `https://115.com/s/sw${i}`,
  password: '',
})

type CheckLinks = (items: LinkCheckItem[]) => Promise<LinkCheckReply>

/** 按给定状态表回复的假 checkLinks（没列出的链接不出现在结果里） */
function fakeApi(states: Record<string, LinkCheckState> = {}): {
  checkLinks: Mock<CheckLinks>
} {
  const checkLinks = vi.fn(
    async (items: LinkCheckItem[]): Promise<LinkCheckReply> => ({
      supported: true,
      results: items
        .filter(item => states[item.url])
        .map(item => ({ url: item.url, state: states[item.url] })),
    })
  )
  return { checkLinks }
}

let clock = 0
const now = (): number => clock

beforeEach(() => {
  vi.useFakeTimers()
  clock = 0
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('攒批、去重、缓存', () => {
  it('排队后攒一批再发，同一链接只发一次', async () => {
    const api = fakeApi()
    const lc = useLinkCheck({ api: () => api, now })
    lc.enqueue(share(1))
    lc.enqueue(share(2))
    lc.enqueue(share(1))
    expect(api.checkLinks).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    expect(api.checkLinks).toHaveBeenCalledTimes(1)
    expect(api.checkLinks.mock.calls[0][0]).toEqual([share(1), share(2)])
  })

  it(`单批不超过 ${MAX_LINK_CHECKS} 条，满了立即发`, async () => {
    const api = fakeApi()
    const lc = useLinkCheck({ api: () => api, now })
    for (let i = 0; i < MAX_LINK_CHECKS + 3; i++) lc.enqueue(share(i))
    await vi.advanceTimersByTimeAsync(0)
    expect(api.checkLinks).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    expect(api.checkLinks.mock.calls.map(([items]) => items.length)).toEqual([
      MAX_LINK_CHECKS,
      3,
    ])
  })

  it('结果按链接缓存，过期后再进视口才重测；在测的链接不重复发', async () => {
    const api = fakeApi({ [share(1).url]: 'bad' })
    const lc = useLinkCheck({ api: () => api, now })
    const first = lc.check(share(1))
    lc.enqueue(share(1))
    expect(await lc.check(share(1))).toBe('bad')
    expect(await first).toBe('bad')
    lc.enqueue(share(1))
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    expect(api.checkLinks).toHaveBeenCalledTimes(1)
    clock = CHECK_TTL_MS
    lc.enqueue(share(1))
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    expect(api.checkLinks).toHaveBeenCalledTimes(2)
  })

  it('IPC 拒绝：当作 unknown，不抛错；unknown 只缓存较短时间', async () => {
    const checkLinks = vi.fn().mockRejectedValue(new Error('handler 崩了'))
    const lc = useLinkCheck({ api: () => ({ checkLinks }), now })
    expect(await lc.check(share(1))).toBe('unknown')
    expect(await lc.check(share(1))).toBe('unknown')
    expect(checkLinks).toHaveBeenCalledTimes(1)
    clock = UNKNOWN_TTL_MS
    await lc.check(share(1))
    expect(checkLinks).toHaveBeenCalledTimes(2)
  })
})

describe('提交与排序', () => {
  it('结果最多每 300ms 提交一次到界面', async () => {
    const api = fakeApi({ [share(1).url]: 'ok', [share(2).url]: 'locked' })
    const lc = useLinkCheck({ api: () => api, now })
    await lc.check(share(1))
    await vi.advanceTimersByTimeAsync(FLUSH_MS / 2)
    await lc.check(share(2))
    expect(lc.stateOf(share(1).url)).toBeUndefined()
    await vi.advanceTimersByTimeAsync(FLUSH_MS / 2)
    expect(lc.stateOf(share(1).url)).toBe('ok')
    expect(lc.stateOf(share(2).url)).toBe('locked')
  })

  it('失效的稳定沉底，其余保持原顺序；没有失效时原样返回', async () => {
    const rows = [1, 2, 3, 4].map(share)
    const api = fakeApi({ [rows[0].url]: 'bad', [rows[2].url]: 'bad' })
    const lc = useLinkCheck({ api: () => api, now })
    expect(lc.order(rows)).toBe(rows)
    await Promise.all(rows.map(row => lc.check(row)))
    await vi.advanceTimersByTimeAsync(FLUSH_MS)
    expect(lc.order(rows).map(row => row.url)).toEqual(
      [rows[1], rows[3], rows[0], rows[2]].map(row => row.url)
    )
  })
})

describe('实例不支持', () => {
  it('记住不支持，之后不再请求；换了实例地址重新尝试', async () => {
    let instance = 'https://a.example'
    const checkLinks = vi.fn(
      async (): Promise<LinkCheckReply> => ({ supported: false })
    )
    const lc = useLinkCheck({
      api: () => ({ checkLinks }),
      instance: () => instance,
      now,
    })
    expect(await lc.check(share(1))).toBe('unknown')
    lc.enqueue(share(2))
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    expect(await lc.check(share(3))).toBe('unknown')
    expect(checkLinks).toHaveBeenCalledTimes(1)
    expect(lc.stateOf(share(1).url)).toBeUndefined()
    instance = 'https://b.example'
    await lc.check(share(1))
    expect(checkLinks).toHaveBeenCalledTimes(2)
  })
})

describe('guardReceive', () => {
  type Receive = (url: string, password: string) => Promise<{ ok: true }>
  const receiveApi = (): { snap: Mock; receive: Mock<Receive> } => ({
    snap: vi.fn(),
    receive: vi.fn(async () => ({ ok: true as const })),
  })

  it('确认失效时不转存，返回提示', async () => {
    const api = fakeApi({ [share(1).url]: 'bad' })
    const base = receiveApi()
    const lc = useLinkCheck({ api: () => api, now })
    const guarded = lc.guardReceive(() => base)()
    expect(await guarded.receive(share(1).url, '')).toEqual({
      ok: false,
      error: DEAD_SHARE,
    })
    expect(base.receive).not.toHaveBeenCalled()
  })

  it('有效、没测出来、实例不支持时照常转存；有缓存时不再请求', async () => {
    const api = fakeApi({ [share(1).url]: 'ok' })
    const base = receiveApi()
    const lc = useLinkCheck({ api: () => api, now })
    await lc.check(share(1))
    const guarded = lc.guardReceive(() => base)()
    await guarded.receive(share(1).url, 'ab12')
    await guarded.receive(share(2).url, '')
    expect(base.receive.mock.calls).toEqual([
      [share(1).url, 'ab12'],
      [share(2).url, ''],
    ])
    expect(api.checkLinks).toHaveBeenCalledTimes(2)
  })
})

describe('v-link-check 可见区观察', () => {
  type Callback = (
    entries: { target: Element; isIntersecting: boolean }[]
  ) => void
  let fire: Callback = () => {}
  const observed = new Set<Element>()

  beforeEach(() => {
    observed.clear()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: Callback) {
          fire = cb
        }
        observe = (el: Element): unknown => observed.add(el)
        unobserve = (el: Element): unknown => observed.delete(el)
        disconnect = (): void => observed.clear()
      }
    )
  })

  const binding = (value: { url: string; receiveCode: string }): never =>
    ({ value, oldValue: undefined }) as never

  it('进入视口才排队，还没发出就离开的出队；卸载停止观察', async () => {
    const api = fakeApi()
    const lc = useLinkCheck({ api: () => api, now })
    const el1 = {} as HTMLElement
    const el2 = {} as HTMLElement
    const mounted = lc.vLinkCheck.mounted as unknown as (
      el: HTMLElement,
      b: never
    ) => void
    mounted(el1, binding({ url: share(1).url, receiveCode: 'ab12' }))
    mounted(el2, binding({ url: share(2).url, receiveCode: '' }))
    expect(observed.size).toBe(2)
    fire([
      { target: el1, isIntersecting: true },
      { target: el2, isIntersecting: true },
    ])
    fire([{ target: el2, isIntersecting: false }])
    await vi.advanceTimersByTimeAsync(GATHER_MS)
    expect(api.checkLinks.mock.calls[0][0]).toEqual([
      { url: share(1).url, password: 'ab12' },
    ])
    ;(lc.vLinkCheck.beforeUnmount as (el: HTMLElement) => void)(el1)
    expect(observed.has(el1)).toBe(false)
  })
})
