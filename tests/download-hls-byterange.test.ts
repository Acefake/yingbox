import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { downloadHls } from '../src/engine/download/hls'
import { createNetClient } from '../src/shared/net/client'

describe('HLS 字节范围清单', () => {
  it.each([
    '#EXTM3U\n#EXTINF:1,\n#EXT-X-BYTERANGE:3@0\nvideo.ts\n#EXTINF:1,\n#EXT-X-BYTERANGE:3\nvideo.ts',
    '#EXTM3U\n#EXT-X-MAP:URI="video.mp4",BYTERANGE="3@0"\n#EXTINF:1,\nsegment.m4s',
  ])('明确拒绝不支持的范围，避免生成错误成品或续传记录', async playlist => {
    const fetch = vi.fn(async () => new Response(playlist))
    const net = createNetClient({
      lookup: async () => [{ address: '93.184.216.34' }],
      fetch,
    })
    const dir = await mkdtemp(join(tmpdir(), 'yb-byterange-'))
    try {
      await expect(
        downloadHls(net, 'https://cdn.test/a.m3u8', join(dir, 'A'))
      ).rejects.toThrow('BYTERANGE')
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
