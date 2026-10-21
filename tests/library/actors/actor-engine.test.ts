/**
 * 演员库端到端：真实引擎（内存库、临时目录）+ 假网络（录制的 JavBus 页面）。
 * 番号识别后演员入库并关联作品 → 后台查资料不阻塞识别 → 手动编辑 → 写出的 NFO 带演员扩展字段 → 按演员查作品。
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryService } from '../../../src/main/library/engine/service'
import { handleRpc } from '../../../src/main/library/engine/rpc'
import { tempTree } from '../engine/helpers'

const PAGES: Record<string, string> = {
  'https://www.javbus.com/SSIS-497': readFileSync(
    join(__dirname, '../../fixtures/jav/javbus-SSIS-497.html'),
    'utf8'
  ),
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

const fetch = async (url: string): Promise<Response> => {
  if (PAGES[url])
    return new Response(PAGES[url], {
      headers: { 'content-type': 'text/html' },
    })
  if (/\.jpe?g$/.test(url))
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { 'content-type': 'image/jpeg' },
    })
  return new Response('not found', { status: 404 })
}

describe('演员库（引擎）', () => {
  it('识别后演员入库、可编辑、NFO 带扩展字段、按演员查作品', async () => {
    tree.write('SSIS-497/SSIS-497.mp4')
    const service = new LibraryService({
      dbPath: ':memory:',
      watch: false,
      identify: { fetch, mediaDir, http: { rps: 1000 } },
    })
    await service.start()
    await service.addLibrary({ root: tree.root, kind: 'movie', source: 'jav' })
    await service.queue.idle()

    const call = async (method: string, params?: unknown): Promise<unknown> => {
      const res = await handleRpc(service, { id: 1, method, params })
      if (!res.ok) throw new Error(res.error.message)
      return res.result
    }
    const list = (await call('actors.list', {})) as {
      items: Array<{ id: number; name: string; workCount: number }>
    }
    const mei = list.items.find(a => a.name === '鷲尾めい')
    expect(mei).toMatchObject({ workCount: 1 })
    // 后台任务查过（假网络都 404 / 无索引），结论落库，不影响影片已入库
    const detail = (await call('actors.get', { actorId: mei!.id })) as {
      profileState: string
    }
    expect(['missing', 'error']).toContain(detail.profileState)

    await call('actors.update', {
      actorId: mei!.id,
      values: {
        birthday: '1998-09-02',
        height: 155,
        images: ['https://pics.example/mei.jpg'],
      },
      lockedFields: ['birthday', 'height', 'images'],
    })
    await expect(
      call('actors.update', {
        actorId: mei!.id,
        values: { height: 999 },
        lockedFields: [],
      })
    ).rejects.toThrow(/height/)

    const item = Number(
      service.db
        .prepare('SELECT id FROM media_items WHERE parent_id IS NULL')
        .get()!.id
    )
    const forItem = (await call('actors.forItem', { itemId: item })) as Array<{
      name: string
      photo: string
    }>
    expect(forItem[0]).toMatchObject({ name: '鷲尾めい' })
    expect(forItem.find(a => a.name === '鷲尾めい')!.photo).toMatch(
      /^yingbox-media:\/\/image\//
    )

    const works = (await call('query', { actorId: mei!.id })) as {
      total: number
    }
    expect(works.total).toBe(1)

    service.writer.write([item])
    await service.queue.idle()
    const dir = join(tree.root, 'SSIS-497')
    const nfo = readFileSync(
      join(dir, readdirSync(dir).find(f => f.endsWith('.nfo'))!),
      'utf8'
    )
    expect(nfo).toMatch(
      /<name>鷲尾めい<\/name>\s*<order>0<\/order>\s*<thumb>https:\/\/pics\.example\/mei\.jpg<\/thumb>\s*<birthdate>1998-09-02<\/birthdate>\s*<height>155<\/height>/
    )
    await service.close()
  })
})
