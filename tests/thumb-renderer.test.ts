import { describe, expect, it, vi } from 'vitest'
import { generateThumbnail } from '@/services/thumbnails/generate'
import { createThumbQueue } from '@/services/thumbnails/queue'

const response = (headers: Record<string, string>, status = 200): Response =>
  new Response(new Blob([new Uint8Array([9, 9])]), { status, headers })

describe('Worker 生成缩略图', () => {
  const deps = () => {
    const bitmap = { width: 1200, height: 1800, close: vi.fn() }
    return {
      bitmap,
      fetch: vi.fn(async () => response({ 'x-thumb': 'miss' })),
      decode: vi.fn(async () => bitmap),
      encode: vi.fn(
        async () => new Blob([new Uint8Array(5)], { type: 'image/webp' })
      ),
    }
  }

  it('命中缓存直接结束，不解码', async () => {
    const d = deps()
    d.fetch.mockResolvedValueOnce(response({ 'x-thumb': 'hit' }))
    expect(await generateThumbnail('thumb://x', 240, d)).toEqual({ hit: true })
    expect(d.decode).not.toHaveBeenCalled()
  })

  it('未命中：按宽度等比缩放并编码 WebP，用完释放位图', async () => {
    const d = deps()
    const result = await generateThumbnail('thumb://x', 240, d)
    expect(d.encode).toHaveBeenCalledWith(d.bitmap, { width: 240, height: 360 })
    expect(result.hit).toBe(false)
    expect(result.hit === false && result.data.byteLength).toBe(5)
    expect(d.bitmap.close).toHaveBeenCalled()
  })

  it('编码失败也释放位图；不支持 WebP（退回 PNG）时报错', async () => {
    const d = deps()
    d.encode.mockRejectedValueOnce(new Error('oom'))
    await expect(generateThumbnail('thumb://x', 240, d)).rejects.toThrow('oom')
    expect(d.bitmap.close).toHaveBeenCalled()
    d.encode.mockResolvedValueOnce(new Blob([], { type: 'image/png' }))
    await expect(generateThumbnail('thumb://x', 240, d)).rejects.toThrow('WebP')
  })

  it('原图取失败时报错', async () => {
    const d = deps()
    d.fetch.mockResolvedValueOnce(response({}, 502))
    await expect(generateThumbnail('thumb://x', 240, d)).rejects.toThrow('502')
  })
})

describe('缩略图请求队列', () => {
  const deferred = () => {
    let resolve!: (v: { data: ArrayBuffer } | { hit: true }) => void
    const promise = new Promise<{ data: ArrayBuffer } | { hit: true }>(
      r => (resolve = r)
    )
    return { promise, resolve }
  }

  it('同一张去重，做完后不再请求', async () => {
    const run = vi.fn(async () => ({ data: new ArrayBuffer(4) }))
    const put = vi.fn(async () => true)
    const q = createThumbQueue({ run, put })
    await Promise.all([q.ensure('a', 240), q.ensure('a', 240)])
    await q.ensure('a', 240)
    expect(run).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledWith('a', 240, new Uint8Array(4))
    // 不同宽度是另一张
    await q.ensure('a', 360)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('命中缓存不落盘', async () => {
    const put = vi.fn(async () => true)
    const q = createThumbQueue({ run: async () => ({ hit: true }), put })
    await q.ensure('a', 240)
    expect(put).not.toHaveBeenCalled()
    expect(q.stats().done).toBe(1)
  })

  it('并发受限', async () => {
    const gates = [deferred(), deferred(), deferred()]
    let i = 0
    const run = vi.fn(() => gates[i++].promise)
    const q = createThumbQueue({ run, put: async () => true, concurrency: 2 })
    const all = ['a', 'b', 'c'].map(s => q.ensure(s, 240))
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(2)
    expect(q.stats()).toMatchObject({ running: 2, waiting: 1 })
    gates[0].resolve({ hit: true })
    await all[0]
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3))
    gates[1].resolve({ hit: true })
    gates[2].resolve({ hit: true })
    await Promise.all(all)
    expect(q.stats()).toEqual({ running: 0, waiting: 0, done: 3 })
  })

  it('失败或主进程拒收不记完成，下次重试', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('decode'))
      .mockResolvedValue({ data: new ArrayBuffer(1) })
    const put = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const q = createThumbQueue({ run, put })
    await q.ensure('a', 240)
    await q.ensure('a', 240)
    await q.ensure('a', 240)
    await q.ensure('a', 240)
    expect(run).toHaveBeenCalledTimes(3)
    expect(q.stats().done).toBe(1)
  })

  it('「已完成」记录有上限', async () => {
    const run = vi.fn(async () => ({ hit: true as const }))
    const q = createThumbQueue({ run, put: async () => true, rememberLimit: 2 })
    for (const s of ['a', 'b', 'c']) await q.ensure(s, 240)
    expect(q.stats().done).toBe(2)
    await q.ensure('a', 240)
    expect(run).toHaveBeenCalledTimes(4)
  })
})
