/**
 * 网盘页的交互状态（组合函数，node 环境直接跑）：IPC 拒绝时复位 loading 并提示、
 * 防重复点击、请求序号防旧响应、扫码异常可重试、复制失败有反馈。
 */
import { type Mock, describe, expect, it, vi } from 'vitest'

import { useNetdiskSearch } from '../../src/renderer/src/features/netdisk/composables/use-netdisk-search'
import { useQrLogin } from '../../src/renderer/src/features/netdisk/composables/use-qr-login'
import { useShareActions } from '../../src/renderer/src/features/netdisk/composables/use-share-actions'
import type {
  NetdiskItem,
  Pan115LoginPoll,
} from '../../src/shared/contract/pan115'

const ITEM: NetdiskItem = {
  title: '示例',
  source: 'tg:x',
  url: 'https://115.com/s/sw1',
  shareCode: 'sw1',
  receiveCode: 'ab12',
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => (resolve = r))
  return { promise, resolve }
}

type Say = (message: string) => void
const notifier = (): { success: Mock<Say>; error: Mock<Say> } => ({
  success: vi.fn<Say>(),
  error: vi.fn<Say>(),
})

describe('useNetdiskSearch', () => {
  it('IPC 拒绝时复位 loading 并给出错误', async () => {
    const search = vi.fn().mockRejectedValue(new Error('handler 崩了'))
    const s = useNetdiskSearch(() => ({ search }))
    s.keyword.value = '纪录片'
    await s.search()
    expect(s.loading.value).toBe(false)
    expect(s.error.value).toContain('handler 崩了')
    expect(s.items.value).toEqual([])
  })

  it('只认最后一次搜索的结果', async () => {
    const first = deferred<{ ok: true; items: NetdiskItem[] }>()
    const search = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true, items: [ITEM] })
    const s = useNetdiskSearch(() => ({ search }))
    s.keyword.value = 'a'
    const a = s.search()
    s.keyword.value = 'b'
    await s.search()
    first.resolve({ ok: true, items: [] })
    await a
    expect(s.items.value).toEqual([ITEM])
    expect(s.loading.value).toBe(false)
  })

  it('新搜索一开始就清掉上一个词的结果并进入加载态', async () => {
    const second = deferred<{ ok: true; items: NetdiskItem[] }>()
    const search = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        items: [ITEM],
        magnets: [],
        notes: [],
      })
      .mockReturnValueOnce(second.promise)
    const s = useNetdiskSearch(() => ({ search }))
    s.keyword.value = '流浪地球'
    await s.search()
    expect(s.items.value).toEqual([ITEM])
    s.keyword.value = '漫长的季节'
    const pending = s.search()
    expect(s.items.value).toEqual([])
    expect(s.searched.value).toBe(false)
    expect(s.loading.value).toBe(true)
    second.resolve({ ok: true, items: [] })
    await pending
    expect(s.searched.value).toBe(true)
  })

  it('reset：清空结果，在途请求晚到也不写回', async () => {
    const late = deferred<{ ok: true; items: NetdiskItem[] }>()
    const search = vi.fn().mockReturnValueOnce(late.promise)
    const s = useNetdiskSearch(() => ({ search }))
    s.keyword.value = 'a'
    const pending = s.search()
    s.keyword.value = ''
    s.reset()
    late.resolve({ ok: true, items: [ITEM] })
    await pending
    expect(s.items.value).toEqual([])
    expect(s.loading.value).toBe(false)
    expect(s.searched.value).toBe(false)
  })
})

describe('useShareActions', () => {
  type Write = (text: string) => Promise<void>
  const clipboard = (fail = false): { writeText: Mock<Write> } => ({
    writeText: fail
      ? vi.fn<Write>().mockRejectedValue(new Error('denied'))
      : vi.fn<Write>().mockResolvedValue(undefined),
  })

  it('复制：带上提取码；剪贴板拒绝时提示复制失败，不抛出', async () => {
    const notify = notifier()
    const ok = clipboard()
    const a = useShareActions({
      api: () => ({}) as never,
      notify,
      clipboard: () => ok,
    })
    await a.copy(ITEM)
    expect(ok.writeText).toHaveBeenCalledWith(
      'https://115.com/s/sw1 提取码：ab12'
    )
    expect(notify.success).toHaveBeenCalled()
    const b = useShareActions({
      api: () => ({}) as never,
      notify,
      clipboard: () => clipboard(true),
    })
    await expect(b.copy(ITEM)).resolves.toBeUndefined()
    expect(notify.error).toHaveBeenCalledWith(
      expect.stringContaining('复制失败')
    )
  })

  it('转存：进行中重复点击只发一次；IPC 抛错时复位并提示', async () => {
    const pending = deferred<{ ok: true }>()
    const receive = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error('ipc'))
    const notify = notifier()
    const a = useShareActions({
      api: () => ({ receive }) as never,
      notify,
      clipboard: () => clipboard(),
    })
    const first = a.save(ITEM)
    await a.save(ITEM)
    expect(receive).toHaveBeenCalledTimes(1)
    expect(a.isSaving(ITEM.url)).toBe(true)
    pending.resolve({ ok: true })
    await first
    expect(a.isSaved(ITEM.url)).toBe(true)
    await a.save(ITEM)
    expect(receive).toHaveBeenCalledTimes(1)

    const other = { ...ITEM, url: 'https://115.com/s/sw2' }
    await a.save(other)
    expect(a.isSaving(other.url)).toBe(false)
    expect(a.isSaved(other.url)).toBe(false)
    expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('ipc'))
  })

  it('预览：加载中重复点击不重发；IPC 抛错时复位并提示；换一条时旧响应作废', async () => {
    const slow = deferred<unknown>()
    const snap = vi
      .fn()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ ok: true, title: 'B', count: 0, files: [] })
      .mockRejectedValueOnce(new Error('boom'))
    const notify = notifier()
    const a = useShareActions({
      api: () => ({ snap }) as never,
      notify,
      clipboard: () => clipboard(),
    })
    const first = a.openPreview(ITEM)
    await a.openPreview(ITEM)
    expect(snap).toHaveBeenCalledTimes(1)
    const other = { ...ITEM, url: 'https://115.com/s/sw2' }
    await a.openPreview(other)
    slow.resolve({ ok: true, title: 'A', count: 0, files: [] })
    await first
    expect(a.preview.item.value?.url).toBe(other.url)
    expect(a.preview.snap.value?.title).toBe('B')
    await a.openPreview({ ...ITEM, url: 'https://115.com/s/sw3' })
    expect(a.preview.loading.value).toBe(false)
    expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('boom'))
  })
})

describe('useQrLogin', () => {
  it('loginStart 抛错：复位 loading、提示，可以再点扫码登录', async () => {
    const notifyError = vi.fn()
    const loginStart = vi.fn().mockRejectedValue(new Error('ipc'))
    const q = useQrLogin({
      api: () => ({ loginStart, loginPoll: vi.fn() }),
      onDone: vi.fn(),
      notifyError,
    })
    await q.start()
    expect(q.loading.value).toBe(false)
    expect(q.qrUrl.value).toBe('')
    expect(notifyError).toHaveBeenCalledWith(expect.stringContaining('ipc'))
  })

  it('loginPoll 抛错：停在错误态并可重试同一张二维码，重试后登录成功', async () => {
    const answers: Array<Pan115LoginPoll | Error> = [
      new Error('ipc 断了'),
      {
        status: 'done',
        account: { loggedIn: true, userId: '1', userName: 'a' },
      },
    ]
    const loginPoll = vi.fn(async () => {
      const next = answers.shift()!
      if (next instanceof Error) throw next
      return next
    })
    const loginStart = vi
      .fn()
      .mockResolvedValue({ ok: true, imageUrl: 'qr.png' })
    const onDone = vi.fn()
    const q = useQrLogin({
      api: () => ({ loginStart, loginPoll }),
      onDone,
      notifyError: vi.fn(),
      intervalMs: 0,
    })
    await q.start()
    expect(q.status.value).toBe('error')
    expect(q.error.value).toContain('ipc 断了')
    expect(q.canRetry.value).toBe(true)
    await q.retry()
    expect(loginStart).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith({
      loggedIn: true,
      userId: '1',
      userName: 'a',
    })
    expect(q.qrUrl.value).toBe('')
  })
})
