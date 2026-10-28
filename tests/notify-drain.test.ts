import { expect, it } from 'vitest'
import { createNotifyService } from '../src/main/notify/notify-service'

for (const merge of [false, true]) {
  it(`关停等待在途发送（合并=${merge}）`, async () => {
    let finish!: () => void
    const gate = new Promise<void>(resolve => {
      finish = resolve
    })
    const service = createNotifyService({
      config: () => ({
        enabled: { system: false, bark: true, telegram: false },
        bark: { server: 'https://example.com', key: 'fake' },
        telegram: null,
        kinds: { autograb: true, episode: true, movie: true },
        merge,
      }),
      fetch: async () => {
        await gate
        return { ok: true, status: 200, text: async () => '{"code":200}' }
      },
      showSystem: () => {},
      autograbSaved: () => false,
    })
    service.landed([
      { seriesId: 1, seriesTitle: '测试剧', season: 1, episode: 1 },
    ])
    if (merge) void service.flush()
    let done = false
    const drain = service.flush().then(() => {
      done = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(done).toBe(false)
    finish()
    await drain
    expect(done).toBe(true)
  })
}
