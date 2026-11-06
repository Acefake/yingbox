import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import { registerAutograb } from '../src/main/autograb'
import type { ModuleHost } from '../src/main/module-host'
import type { LibraryEngineClient } from '../src/main/library/client'
import { defaultValues } from '../src/shared/settings/schema'

vi.mock('../src/main/autograb/tmdb-http', () => ({
  createTmdbGet: () => async (path: string) =>
    path === '/search/tv'
      ? { results: [{ id: 99, name: '测试剧', first_air_date: '2026-10-20' }] }
      : path.includes('/season/')
        ? { episodes: [{ episode_number: 1, air_date: '2026-10-20' }] }
        : {
            id: 99,
            name: '测试剧',
            first_air_date: '2026-10-20',
            seasons: [{ season_number: 1, air_date: '2026-10-20' }],
          },
}))

it('真实模块入口可在媒体库不可用时创建并持久化独立任务', async () => {
  const prefix = join(tmpdir(), 'yb-autograb-registration-')
  const directory = await mkdtemp(prefix)
  const values = defaultValues()
  const implement = vi.fn<ModuleHost['implement']>()
  const host: ModuleHost = {
    dataDir: directory,
    setting: key => values[key],
    tmdbToken: () => 'fixture',
    implement,
    emit: vi.fn(),
    schedule: vi.fn(),
  }
  const call = vi.fn<LibraryEngineClient['call']>(async () => {
    throw new Error('library offline')
  })
  const pan = {
    account: async () => ({ loggedIn: false as const }),
    searchRaw: async () => [],
    use: async (): Promise<never> => {
      throw new Error('not logged in')
    },
  }
  try {
    const service = registerAutograb(host, { call }, pan)
    const handlers = implement.mock.calls[0][1]
    expect(
      await handlers.trackOnline(undefined, { title: '测试剧', year: 2026 })
    ).toMatchObject({ status: 'ready', seriesId: 1 })
    await service.tick()
    expect(call).not.toHaveBeenCalled()
    await vi.waitFor(async () => {
      const stored = JSON.parse(
        await readFile(join(directory, 'autograb.json'), 'utf8')
      )
      expect(stored).toMatchObject({
        version: 2,
        series: { '1': { tmdbId: '99', title: '测试剧', pending: true } },
      })
    })
  } finally {
    expect(resolve(directory).startsWith(resolve(prefix))).toBe(true)
    await rm(directory, { recursive: true, force: true })
  }
})
