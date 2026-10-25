/**
 * 115 webapi 客户端：快照、转存翻页与上限、文件夹分页、错误码与 Cookie 不外泄。
 * Cookie 由传输层（分区 Cookie 罐）带上，客户端自己不写 Cookie 头。
 */
import { describe, expect, it } from 'vitest'

import { create115Client } from '../../src/main/pan115/client'
import type { Pan115Session } from '../../src/main/pan115/service'
import {
  FILES_ROOT,
  SNAP_OK,
  dirsPage,
  fail,
  fakeFetch,
  snapPage,
} from './fixtures'

const SESSION: Pan115Session = {
  cookie: 'UID=10086_A1_1; CID=cid-x; SEID=seid-x; KID=kid-x',
  userId: '10086',
  userName: '影盒用户',
}
const ref = { shareCode: 'swh3abc12', receiveCode: 'x1y2' }
const offsetOf = (url: string): number =>
  Number(new URL(url).searchParams.get('offset'))
/** 按 offset 返回快照页的路由 */
const pagedSnap =
  (total: number, withCount = true) =>
  (req: { url: string }): unknown => {
    const offset = offsetOf(req.url)
    return snapPage(
      offset,
      Math.max(0, Math.min(100, total - offset)),
      withCount ? total : undefined
    )
  }
const fileIds = (body: string): string[] =>
  (new URLSearchParams(body).get('file_id') ?? '').split(',').filter(Boolean)

describe('115 webapi', () => {
  it('客户端不自己写 Cookie 头（交给分区 Cookie 罐）', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': SNAP_OK,
    })
    await create115Client(fetch, SESSION).snap(ref)
    expect(sent[0].headers.cookie).toBeUndefined()
  })

  it('snap：查询参数与文件列表', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': SNAP_OK,
    })
    const snap = await create115Client(fetch, SESSION).snap(ref)
    expect(Object.fromEntries(new URL(sent[0].url).searchParams)).toEqual({
      share_code: 'swh3abc12',
      receive_code: 'x1y2',
      offset: '0',
      limit: '100',
      cid: '',
    })
    expect(snap).toEqual({
      title: '示例纪录片',
      count: 2,
      files: [
        { id: '900', name: '第一季', size: 0, isDir: true },
        { id: '901', name: 'S01E01.mkv', size: 1024, isDir: false },
      ],
    })
  })

  it('snap 失败按错误码抛出', async () => {
    const { fetch } = fakeFetch({
      'https://webapi.115.com/share/snap': fail(4100008),
    })
    await expect(create115Client(fetch, SESSION).snap(ref)).rejects.toThrow(
      '提取码'
    )
  })

  it('receive：表单 POST，file_id 为快照里全部顶层条目', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': SNAP_OK,
      'https://webapi.115.com/share/receive': { state: true, errno: 0 },
    })
    await create115Client(fetch, SESSION).receive(ref, '777')
    const post = sent[1]
    expect(post.method).toBe('POST')
    expect(post.headers['content-type']).toContain(
      'application/x-www-form-urlencoded'
    )
    expect(Object.fromEntries(new URLSearchParams(post.body))).toEqual({
      share_code: 'swh3abc12',
      receive_code: 'x1y2',
      file_id: '900,901',
      cid: '777',
      user_id: '10086',
    })
  })

  it('receive 翻多页：offset 按每页条数递增，最后一页不足 100 时停', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': pagedSnap(250),
      'https://webapi.115.com/share/receive': { state: true, errno: 0 },
    })
    await create115Client(fetch, SESSION).receive(ref, '0')
    const snaps = sent.filter(r => r.url.includes('/share/snap'))
    expect(snaps.map(r => offsetOf(r.url))).toEqual([0, 100, 200])
    expect(fileIds(sent.at(-1)!.body)).toHaveLength(250)
  })

  it('receive：115 不返回 count 时不截断成第一页，翻到不足一页为止', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': pagedSnap(250, false),
      'https://webapi.115.com/share/receive': { state: true, errno: 0 },
    })
    await create115Client(fetch, SESSION).receive(ref, '0')
    expect(fileIds(sent.at(-1)!.body)).toHaveLength(250)
  })

  it('receive：缺 id 的条目跳过，但 offset 仍按原始条数推进', async () => {
    const page0 = snapPage(0, 100, 150) as { data: { list: object[] } }
    page0.data.list[5] = { n: '坏条目' }
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': (req: { url: string }) =>
        offsetOf(req.url) === 0 ? page0 : snapPage(100, 50, 150),
      'https://webapi.115.com/share/receive': { state: true, errno: 0 },
    })
    await create115Client(fetch, SESSION).receive(ref, '0')
    const snaps = sent.filter(r => r.url.includes('/share/snap'))
    expect(snaps.map(r => offsetOf(r.url))).toEqual([0, 100])
    const ids = fileIds(sent.at(-1)!.body)
    expect(ids).toHaveLength(149)
    expect(ids).not.toContain('')
  })

  it('receive：超过一次转存上限时报错，不静默只存一部分', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': pagedSnap(5000),
      'https://webapi.115.com/share/receive': { state: true, errno: 0 },
    })
    await expect(
      create115Client(fetch, SESSION).receive(ref, '0')
    ).rejects.toThrow('上限')
    expect(sent.some(r => r.url.includes('/share/receive'))).toBe(false)
  })

  it('receive：不报 count 却一直满页时，到页数上限也报错', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': (req: { url: string }) =>
        snapPage(offsetOf(req.url), 100),
      'https://webapi.115.com/share/receive': { state: true, errno: 0 },
    })
    await expect(
      create115Client(fetch, SESSION).receive(ref, '0')
    ).rejects.toThrow('上限')
    expect(sent.some(r => r.url.includes('/share/receive'))).toBe(false)
  })

  it('receive：空分享报错', async () => {
    const { fetch } = fakeFetch({
      'https://webapi.115.com/share/snap': snapPage(0, 0, 0),
    })
    await expect(
      create115Client(fetch, SESSION).receive(ref, '0')
    ).rejects.toThrow('分享里没有文件')
  })

  it('receive 的各个错误码', async () => {
    for (const [errno, text] of [
      [4100024, '已经接收过'],
      [4100010, '取消'],
      [4100018, '过期'],
      [911, '安全验证'],
      [99, '重新扫码登录'],
    ] as const) {
      const { fetch } = fakeFetch({
        'https://webapi.115.com/share/snap': SNAP_OK,
        'https://webapi.115.com/share/receive': fail(errno),
      })
      await expect(
        create115Client(fetch, SESSION).receive(ref, '0')
      ).rejects.toThrow(text)
    }
  })

  it('dirs：只留文件夹，带面包屑', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/files': FILES_ROOT,
    })
    const listing = await create115Client(fetch, SESSION).dirs('0')
    const url = new URL(sent[0].url)
    expect(url.searchParams.get('cid')).toBe('0')
    expect(url.searchParams.get('show_dir')).toBe('1')
    expect(listing).toEqual({
      cid: '0',
      path: [{ cid: '0', name: '根目录' }],
      dirs: [
        { cid: '10', name: '电影' },
        { cid: '11', name: '剧集' },
      ],
      truncated: false,
    })
  })

  it('dirs：超过一页时按 offset 分页取全', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/files': (req: { url: string }) => {
        const offset = offsetOf(req.url)
        return dirsPage(offset, Math.min(200, 450 - offset), 450)
      },
    })
    const listing = await create115Client(fetch, SESSION).dirs('0')
    expect(sent.map(r => offsetOf(r.url))).toEqual([0, 200, 400])
    expect(listing.dirs).toHaveLength(450)
    expect(listing.truncated).toBe(false)
  })

  it('dirs：多到上限时停下并标记 truncated', async () => {
    const { fetch } = fakeFetch({
      'https://webapi.115.com/files': (req: { url: string }) =>
        dirsPage(offsetOf(req.url), 200, 99999),
    })
    const listing = await create115Client(fetch, SESSION).dirs('0')
    expect(listing.truncated).toBe(true)
    expect(listing.dirs.length).toBeGreaterThan(0)
  })

  it('错误信息里不带 Cookie 的任何一项（UID / CID / SEID / KID）', async () => {
    for (const value of ['10086_A1_1', 'cid-x', 'seid-x', 'kid-x']) {
      const { fetch } = fakeFetch({
        'https://webapi.115.com/files': fail(1, `出错了 ${value} 请重试`),
      })
      const error = await create115Client(fetch, SESSION)
        .dirs('0')
        .catch((e: Error) => e)
      expect((error as Error).message).not.toContain(value)
    }
  })
})
