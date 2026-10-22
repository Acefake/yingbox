/**
 * 引擎入口接线（src/engine/index.ts）：引擎一启动就恢复下载队列并清扫孤儿临时文件，
 * 下载目录是经宿主方法 downloadDir 向主进程要的。
 */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FromUtility, ToUtility } from '../src/shared/utility/protocol'

vi.mock('electron', () => ({
  net: { fetch: async () => new Response('', { status: 404 }) },
}))
vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
}))

type Listener = (e: { data: ToUtility }) => void
const realArgv = process.argv
const proc = process as unknown as { parentPort?: unknown }

afterEach(() => {
  process.argv = realArgv
  delete proc.parentPort
})

describe('引擎入口：启动时清扫孤儿临时文件', () => {
  it('加载入口后，下载目录里 7 天没动的孤儿 .partial 被删，新的留着', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'engine-ud-'))
    const downloads = mkdtempSync(join(tmpdir(), 'engine-dl-'))
    const put = (rel: string, ageDays: number): void => {
      const p = join(downloads, rel)
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, 'x')
      const t = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000)
      utimesSync(p, t, t)
    }
    put('OLD-1/OLD-1.ts.partial', 30)
    put('OLD-1/OLD-1.ts.partial.segs', 30)
    put('NEW-1/NEW-1.ts.partial', 1)

    vi.resetModules()
    let listener: Listener = () => {}
    const asked: string[] = []
    proc.parentPort = {
      postMessage: (m: FromUtility) => {
        if (m.kind !== 'host') return
        asked.push(m.method)
        listener({
          data: { kind: 'reply', id: m.id, ok: true, value: downloads },
        })
      },
      on: (_event: string, fn: Listener) => (listener = fn),
    }
    process.argv = [realArgv[0], 'engine.js', userData]
    await import('../src/engine/index')

    await vi.waitFor(async () =>
      expect((await readdir(downloads)).sort()).toEqual(['NEW-1'])
    )
    expect(asked).toContain('downloadDir')
  }, 30_000)
})
