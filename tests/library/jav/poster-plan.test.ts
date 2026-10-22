/**
 * 番号海报选择：有码片站点海报够清楚就用原生图，缺失 / 太小 / 探测失败才从封面裁；无码不裁。
 * 以及探测用的文件头尺寸解析。
 */
import { describe, expect, it, vi } from 'vitest'
import { imageSize } from '../../../src/main/library/images/image-size'
import { ProviderHttp } from '../../../src/main/library/providers/http/provider-http'
import { JavProvider } from '../../../src/main/library/providers/jav/jav-provider'
import type {
  JavRecord,
  JavSite,
} from '../../../src/main/library/providers/jav/types'
import { encodeJpeg } from '../../../src/main/thumbnails/image-codec'
import { DEFAULT_JAV_SETTINGS } from '../../../src/shared/library/ipc'

const COVER = 'https://pics.dmm.co.jp/x/abc00001pl.jpg'
const POSTER = 'https://pics.dmm.co.jp/x/abc00001ps.jpg'

function provider(
  code: string,
  patch: Partial<JavRecord>,
  probe?: (
    url: string
  ) => Promise<{ width: number; height: number } | undefined>
): JavProvider {
  const site: JavSite = {
    id: 'javbus',
    supports: () => true,
    fetch: async () => ({
      site: 'javbus',
      code,
      url: 'https://javbus/x',
      tags: [],
      actors: [],
      stills: [],
      ...patch,
    }),
  }
  return new JavProvider({
    http: new ProviderHttp({
      fetch: async () => ({
        status: 500,
        headers: { get: () => null },
        text: async () => '',
      }),
      maxRetries: 0,
    }),
    sites: [site],
    settings: () => DEFAULT_JAV_SETTINGS,
    probeImage: probe,
    now: () => 1000,
  })
}

const posters = async (p: JavProvider, code: string): Promise<string[]> =>
  ((await p.metadata(code))?.images ?? [])
    .filter(i => i.role === 'poster')
    .map(i => i.path)

describe('番号海报选择', () => {
  it('站点给原生高清海报：直接用，不裁', async () => {
    const probe = vi.fn(async () => ({ width: 800, height: 1136 }))
    const p = provider('SSIS-497', { cover: COVER, poster: POSTER }, probe)
    expect(await posters(p, 'SSIS-497')).toEqual([POSTER])
    expect(probe).toHaveBeenCalledWith(POSTER, undefined)
  })

  it('站点海报太小、是横图或探测失败：先用封面裁出的图，站点海报兜底', async () => {
    const sized =
      (poster: { width: number; height: number } | undefined) =>
      async (url: string) =>
        url === COVER ? { width: 800, height: 538 } : poster
    const small = provider(
      'SSIS-497',
      { cover: COVER, poster: POSTER },
      sized({ width: 147, height: 200 })
    )
    expect(await posters(small, 'SSIS-497')).toEqual([
      `${COVER}#yingbox=poster-right`,
      POSTER,
    ])
    const wide = provider(
      'SSIS-497',
      { cover: COVER, poster: POSTER },
      sized({ width: 1680, height: 944 })
    )
    expect((await posters(wide, 'SSIS-497'))[0]).toBe(
      `${COVER}#yingbox=poster-right`
    )
    const failed = provider(
      'SSIS-497',
      { cover: COVER, poster: POSTER },
      sized(undefined)
    )
    expect((await posters(failed, 'SSIS-497'))[0]).toBe(
      `${COVER}#yingbox=poster-right`
    )
  })

  it('站点没有海报：从封面裁', async () => {
    const p = provider('SSIS-497', { cover: COVER }, async url =>
      url === COVER ? { width: 800, height: 538 } : undefined
    )
    expect(await posters(p, 'SSIS-497')).toEqual([
      `${COVER}#yingbox=poster-right`,
    ])
  })

  it('DMM 高清图床有原生高清海报：直接用高清 ps.jpg，封面也换高清', async () => {
    const pics = 'https://pics.dmm.co.jp/digital/video/ipzz00300/ipzz00300'
    const aws =
      'https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/ipzz00300/ipzz00300'
    const sizes: Record<string, { width: number; height: number }> = {
      [`${aws}pl.jpg`]: { width: 2184, height: 1468 },
      [`${aws}ps.jpg`]: { width: 1032, height: 1468 },
      [`${pics}pl.jpg`]: { width: 800, height: 538 },
      [`${pics}ps.jpg`]: { width: 147, height: 200 },
    }
    const p = provider(
      'IPZZ-300',
      { cover: `${pics}pl.jpg`, poster: `${pics}ps.jpg` },
      async url => sizes[url]
    )
    const meta = await p.metadata('IPZZ-300')
    const of = (role: string): string[] =>
      (meta?.images ?? []).filter(i => i.role === role).map(i => i.path)
    expect(of('poster')).toEqual([`${aws}ps.jpg`])
    expect(of('backdrop')).toEqual([`${aws}pl.jpg`])
  })

  it('高清图床缺图（老片）：退回标准图床，从封面裁', async () => {
    const pics = 'https://pics.dmm.co.jp/digital/video/ssis00497/ssis00497'
    const sizes: Record<string, { width: number; height: number }> = {
      [`${pics}pl.jpg`]: { width: 800, height: 538 },
      [`${pics}ps.jpg`]: { width: 147, height: 200 },
    }
    const p = provider(
      'SSIS-497',
      { cover: `${pics}pl.jpg`, poster: `${pics}ps.jpg` },
      async url => sizes[url]
    )
    expect(await posters(p, 'SSIS-497')).toEqual([
      `${pics}pl.jpg#yingbox=poster-right`,
      `${pics}ps.jpg`,
    ])
  })

  it('无码封面没有固定版式：不裁', async () => {
    const p = provider('HEYZO-1234', { cover: COVER }, async () => undefined)
    expect(await posters(p, 'HEYZO-1234')).toEqual([COVER])
  })
})

describe('imageSize', () => {
  it('JPEG / PNG / GIF / WebP 文件头', async () => {
    const jpeg = await encodeJpeg(
      { rgba: new Uint8Array(30 * 20 * 4), width: 30, height: 20 },
      80
    )
    expect(imageSize(jpeg)).toEqual({ width: 30, height: 20 })
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    new DataView(png.buffer).setUint32(16, 379)
    new DataView(png.buffer).setUint32(20, 538)
    expect(imageSize(png)).toEqual({ width: 379, height: 538 })
    const gif = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 5, 0,
    ])
    expect(imageSize(gif)).toEqual({ width: 10, height: 5 })
    const webp = new Uint8Array(30)
    webp.set(
      [...'RIFF'].map(c => c.charCodeAt(0)),
      0
    )
    webp.set(
      [...'WEBPVP8X'].map(c => c.charCodeAt(0)),
      8
    )
    webp.set([99, 0, 0, 199, 0, 0], 24)
    expect(imageSize(webp)).toEqual({ width: 100, height: 200 })
    expect(imageSize(new Uint8Array(12))).toBeUndefined()
  })
})
