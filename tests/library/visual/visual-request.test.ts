import { expect, it, vi } from 'vitest'
import { visualRequest } from '../../../src/renderer/src/features/library/visual/visual-request'
it('原生推理串行执行，已取消的排队检索不启动，失败不阻塞后续请求', async () => {
  let release!: () => void
  const first = visualRequest(
    () => true,
    () =>
      new Promise<void>(resolve => {
        release = resolve
      })
  )
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  let active = true
  const encode = vi.fn(async () => 'old')
  const canceled = visualRequest(() => active, encode)
  active = false
  const latest = visualRequest(
    () => true,
    async () => 'latest'
  )
  release()
  await first
  expect(await canceled).toBeNull()
  expect(encode).not.toHaveBeenCalled()
  expect(await latest).toBe('latest')
  await expect(
    visualRequest(
      () => true,
      async () => {
        throw new Error('failed')
      }
    )
  ).rejects.toThrow('failed')
  expect(
    await visualRequest(
      () => true,
      async () => 1
    )
  ).toBe(1)
})
