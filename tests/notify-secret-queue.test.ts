// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'

const pending = vi.hoisted(() => [] as { value: string; finish(): void }[])
vi.mock('../src/renderer/src/features/notify/api', () => ({
  notificationApi: () => ({
    configured: async () => ({ bark: false, telegram: false }),
    setSecret: (_channel: string, value: string) =>
      new Promise<void>(resolve => pending.push({ value, finish: resolve })),
  }),
}))
vi.mock('@/components/ui', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/services/library-server', () => ({
  isWebRuntime: () => false,
  serverFetch: vi.fn(),
}))
vi.mock('@/features/settings', async () => ({
  createTokenDraft: (
    await import('../src/renderer/src/features/settings/tmdb-token')
  ).createTokenDraft,
}))

afterEach(() => vi.useRealTimers())
it('密钥保存按输入顺序执行，清除和 settled 等待全部已排队写入', async () => {
  vi.useFakeTimers()
  const { secretField } =
    await import('../src/renderer/src/features/notify/secret-field')
  const field = secretField('notify.bark.key')
  field.draft.input('A')
  await vi.advanceTimersByTimeAsync(600)
  field.draft.input('B')
  await vi.advanceTimersByTimeAsync(600)
  field.draft.clear()
  expect(pending.map(p => p.value)).toEqual(['A'])
  pending[0].finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(pending.map(p => p.value)).toEqual(['A', 'B'])
  pending[1].finish()
  await vi.advanceTimersByTimeAsync(0)
  expect(pending.map(p => p.value)).toEqual(['A', 'B', ''])
  let done = false
  const saved = field.settled().then(() => {
    done = true
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(done).toBe(false)
  pending[2].finish()
  await saved
  expect(field.configured.value).toBe(false)
})
