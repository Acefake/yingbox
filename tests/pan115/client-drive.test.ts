/**
 * 115 webapi 客户端 · 自己网盘：列条目（追更查重 / 找转存出的文件）、剩余空间、删除单个文件、分享子目录翻页。
 */
import { describe, expect, it } from 'vitest'

import { create115Client } from '../../src/main/pan115/client'
import type { Pan115Session } from '../../src/main/pan115/service'
import { fail, fakeFetch, snapPage } from './fixtures'

const SESSION: Pan115Session = {
  cookie: 'UID=10086_A1_1; CID=cid-x; SEID=seid-x; KID=kid-x',
  userId: '10086',
  userName: '影盒用户',
}

describe('115 webapi · 自己网盘', () => {
  it('entries：文件带 fid 和体积，文件夹用 cid；按上传时间新到旧', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/files': {
        state: true,
        data: [
          { fid: '501', cid: '55', n: 'a.mkv', s: '2048' },
          { cid: '60', n: '子文件夹' },
          { fid: '', cid: '', n: '' },
        ],
      },
    })
    const entries = await create115Client(fetch, SESSION).entries('55')
    const query = new URL(sent[0].url).searchParams
    expect(query.get('cid')).toBe('55')
    expect(query.get('o')).toBe('user_ptime')
    expect(query.get('asc')).toBe('0')
    expect(entries).toEqual([
      { id: '501', name: 'a.mkv', size: 2048, isDir: false },
      { id: '60', name: '子文件夹', size: 0, isDir: true },
    ])
  })

  it('space：读 space_info 的总空间与剩余', async () => {
    const { fetch } = fakeFetch({
      'https://webapi.115.com/files/index_info': {
        state: true,
        data: {
          space_info: {
            all_total: { size: 1000 },
            all_remain: { size: 300 },
          },
        },
      },
    })
    expect(await create115Client(fetch, SESSION).space()).toEqual({
      total: 1000,
      remain: 300,
    })
  })

  it('space：没给数字时报错，不当成 0', async () => {
    const { fetch } = fakeFetch({
      'https://webapi.115.com/files/index_info': { state: true, data: {} },
    })
    await expect(create115Client(fetch, SESSION).space()).rejects.toThrow(
      '剩余空间'
    )
  })

  it('deleteFile：表单 POST 只带一个 fid', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/rb/delete': { state: true },
    })
    await create115Client(fetch, SESSION).deleteFile('55', '501')
    expect(sent[0].method).toBe('POST')
    expect(Object.fromEntries(new URLSearchParams(sent[0].body))).toEqual({
      pid: '55',
      'fid[0]': '501',
      ignore_warn: '1',
    })
  })

  it('deleteFile：id 不是数字时不发请求；115 报错照常抛出', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/rb/delete': fail(990009),
    })
    const client = create115Client(fetch, SESSION)
    await expect(client.deleteFile('55', '1,2')).rejects.toThrow()
    expect(sent).toHaveLength(0)
    await expect(client.deleteFile('55', '501')).rejects.toThrow()
  })

  it('snapDir：带 offset 翻页', async () => {
    const { fetch, sent } = fakeFetch({
      'https://webapi.115.com/share/snap': snapPage(100, 20, 120),
    })
    const ref = { shareCode: 'swh3abc12', receiveCode: 'x1y2' }
    await create115Client(fetch, SESSION).snapDir(ref, '77', 100)
    const query = new URL(sent[0].url).searchParams
    expect(query.get('offset')).toBe('100')
    expect(query.get('cid')).toBe('77')
  })
})
