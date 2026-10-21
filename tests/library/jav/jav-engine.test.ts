/**
 * 番号库端到端：真实引擎（内存库、临时目录）+ 假网络（录制的站点页面）。
 * 扫描按番号分组 → 不需要 TMDB 令牌自动识别 → 入库 / 缓存图片 → 刷新 → 手动匹配 → 写出 NFO。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../../src/main/library/engine/service'
import { tempTree } from '../engine/helpers'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '../../fixtures/jav', name), 'utf8')

const PAGES: Record<string, string> = {
  'https://www.javbus.com/SSIS-497': fixture('javbus-SSIS-497.html'),
  'https://www.avbase.net/works/SSIS-497': fixture('avbase-work.html'),
  'https://adult.contents.fc2.com/article/3662771/':
    fixture('fc2-3662771.html'),
}

let tree: ReturnType<typeof tempTree>
let mediaDir: string
beforeEach(() => {
  tree = tempTree()
  mediaDir = mkdtempSync(join(tmpdir(), 'yingbox-media-'))
})
afterEach(() => {
  tree.cleanup()
  rmSync(mediaDir, { recursive: true, force: true })
})

/** 假网络：登记的页面返回 HTML，图片地址返回一个小 JPEG，其余 404；记录请求头。 */
function fakeNet(): {
  fetch: (
    url: string,
    init: { headers?: Record<string, string> }
  ) => Promise<Response>
  requests: Array<{ url: string; headers: Record<string, string> }>
} {
  const requests: Array<{ url: string; headers: Record<string, string> }> = []
  return {
    requests,
    fetch: async (url, init) => {
      requests.push({ url, headers: init.headers ?? {} })
      if (PAGES[url]) {
        return new Response(PAGES[url], {
          headers: { 'content-type': 'text/html' },
        })
      }
      if (/\.jpe?g$/.test(url)) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
          headers: { 'content-type': 'image/jpeg' },
        })
      }
      return new Response('not found', { status: 404 })
    },
  }
}

describe('番号库', () => {
  it('扫描分组、自动识别（无 TMDB 令牌）、刷新、手动匹配、写出 NFO', async () => {
    tree.write('SSIS-497/SSIS-497-C.mp4')
    tree.write('SSIS-497/ssis00497.part2.mp4')
    tree.write('FC2-PPV-3662771.mp4')
    tree.write('random video.mp4')
    const net = fakeNet()
    const service = new LibraryService({
      dbPath: ':memory:',
      watch: false,
      identify: { fetch: net.fetch, mediaDir, http: { rps: 1000 } },
    })
    await service.start()
    const lib = await service.addLibrary({
      root: tree.root,
      kind: 'movie',
      source: 'jav',
    })
    expect(lib.source).toBe('jav')
    await service.queue.idle()

    const rows = service.db
      .prepare(
        `SELECT id, title, tmdb_id, match_state, poster, original_title FROM media_items
         WHERE parent_id IS NULL ORDER BY title`
      )
      .all() as Array<Record<string, string | number | null>>
    expect(rows).toHaveLength(3)
    const [fc2, ssis, random] = rows
    expect(ssis).toMatchObject({
      tmdb_id: 'SSIS-497',
      match_state: 'auto',
      original_title:
        '最高のオンナ鷲尾めいが人生最高に尽くす一生忘れられない1日限定愛人契約',
    })
    expect(String(ssis.title)).toMatch(/^SSIS-497 最高のオンナ/)
    expect(String(ssis.poster)).toMatch(/^yingbox-media:\/\/image\//)
    expect(fc2).toMatchObject({
      tmdb_id: 'FC2-PPV-3662771',
      match_state: 'auto',
    })
    expect(random).toMatchObject({ match_state: 'unmatched', tmdb_id: null })

    // 两个分段 / 字幕版文件归同一条目
    const files = service.getItem({ itemId: Number(ssis.id) })!.files
    expect(files.map(f => f.path.split(/[\\/]/).pop()).sort()).toEqual([
      'SSIS-497-C.mp4',
      'ssis00497.part2.mp4',
    ])
    // 聚合：javbus 优先（演员头像），avbase 补简介
    const meta = service.getItem({ itemId: Number(ssis.id) })!.metadata
    expect(meta).toMatchObject({
      level: 'title',
      ref: { provider: 'jav', id: 'SSIS-497' },
    })
    if (meta?.level !== 'title') throw new Error('expected title metadata')
    expect(meta.overview).toMatch(/^「今日だけだから/)
    expect(meta.cast[0]).toMatchObject({ name: '鷲尾めい' })
    expect(meta.companies).toEqual([
      'エスワン ナンバーワンスタイル',
      'S1 NO.1 STYLE',
    ])
    const provider = service.db
      .prepare('SELECT provider, provider_id FROM matches WHERE item_id = ?')
      .get(Number(ssis.id))
    expect(provider).toEqual({ provider: 'jav', provider_id: 'movie:SSIS-497' })

    // JavBus 图片带同源 Referer；站点页面带 UA
    const cover = net.requests.find(r => r.url.includes('javbus.com/pics/'))
    expect(cover?.headers.Referer).toBe('https://www.javbus.com/')
    const page = net.requests.find(
      r => r.url === 'https://www.javbus.com/SSIS-497'
    )
    expect(page?.headers.Cookie).toContain('dv=1')

    // 刷新元数据（番号库同样不需要令牌），站点结果走缓存不再请求页面
    const before = net.requests.length
    service.refreshMetadata({ libraryId: lib.id })
    await service.queue.idle()
    expect(
      net.requests
        .slice(before)
        .some(r => r.url === 'https://www.javbus.com/SSIS-497')
    ).toBe(false)

    // 手动匹配：输入的番号按规则归一后查询，默认锁定
    const manual = await service.applyMatch({
      itemId: Number(random.id),
      query: { title: 'fc2ppv 3662771' },
    })
    expect(manual.status).toBe('matched')
    expect(manual.item).toMatchObject({
      matchState: 'locked',
      providerIds: { tmdb: 'FC2-PPV-3662771' },
    })
    await expect(
      service.applyMatch({ itemId: Number(random.id), tmdbId: '123' })
    ).rejects.toThrow(/番号/)

    // 写出：NFO 里是番号 uniqueid，类别写 tag，剧照进 fanart
    service.writer.write([Number(ssis.id)])
    await service.queue.idle()
    const dir = join(tree.root, 'SSIS-497')
    const nfoName = readdirSync(dir).find(f => f.endsWith('.nfo'))
    expect(nfoName).toBeDefined()
    const nfo = readFileSync(join(dir, nfoName!), 'utf8')
    expect(nfo).toContain(
      '<uniqueid type="num" default="true">SSIS-497</uniqueid>'
    )
    expect(nfo).toContain('<num>SSIS-497</num>')
    expect(nfo).toContain('<tag>巨乳</tag>')
    expect(nfo).toContain(
      '<set>\n    <name>一生忘れられない1日限定愛人契約</name>'
    )
    expect(nfo).not.toContain('themoviedb')
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(['poster.jpg']))
    await service.close()
  })
})
