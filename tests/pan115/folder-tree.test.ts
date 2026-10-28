/**
 * 115 目录树（useFolderTree）：只在展开时读子文件夹、读过的按 cid 缓存（跨实例共用、并发展开只请求一次、过期重读）、
 * 出错与空文件夹的说明行；以及网盘页转存 / 磁力离线把选中的文件夹传给主进程。
 */
import { describe, expect, it, vi } from 'vitest'

import type {
  Pan115DirListing,
  Pan115Result,
} from '../../src/shared/contract/pan115'
import {
  TREE_CACHE_LIMIT,
  TREE_TTL_MS,
  createFolderTreeCache,
  useFolderTree,
} from '../../src/renderer/src/features/netdisk/composables/use-folder-tree'
import { useOfflineAdd } from '../../src/renderer/src/features/netdisk/composables/use-offline'
import { useShareActions } from '../../src/renderer/src/features/netdisk/composables/use-share-actions'

const TREE: Record<string, { cid: string; name: string }[]> = {
  '0': [
    { cid: '1', name: '电影' },
    { cid: '2', name: '剧集' },
  ],
  '1': [{ cid: '11', name: '2024' }],
  '2': [],
}

function dirsApi(): ReturnType<
  typeof vi.fn<(cid: string) => Promise<Pan115Result<Pan115DirListing>>>
> {
  return vi.fn(async (cid: string) =>
    TREE[cid]
      ? { ok: true as const, cid, path: [], dirs: TREE[cid], truncated: false }
      : { ok: false as const, error: '文件夹不存在' }
  )
}

const shape = (
  rows: ReturnType<typeof useFolderTree>['rows']['value']
): string[] =>
  rows.map(r =>
    r.type === 'dir'
      ? `${'  '.repeat(r.depth)}${r.name}${r.expanded ? '/' : ''}`
      : `${'  '.repeat(r.depth)}(${r.text})`
  )

describe('useFolderTree', () => {
  it('缓存有上限，淘汰后已展开的目录仍然显示，重新打开会重读', async () => {
    const cache = createFolderTreeCache()
    const dirs = vi.fn(async (cid: string) => ({
      ok: true as const,
      cid,
      path: [],
      dirs: [{ cid: `${cid}-child`, name: '子目录' }],
      truncated: false,
    }))
    const tree = useFolderTree(() => ({ dirs }), { cache })
    await tree.start()
    for (let i = 1; i <= TREE_CACHE_LIMIT; i++) await tree.load(String(i))
    expect(cache.entries.size).toBe(TREE_CACHE_LIMIT)
    expect(cache.entries.has('0')).toBe(false)
    expect(shape(tree.rows.value)).toEqual(['根目录/', '  子目录'])
    await tree.toggle('0')
    await tree.toggle('0')
    expect(dirs.mock.calls.filter(([cid]) => cid === '0')).toHaveLength(2)
  })
  it('打开只读根目录；展开某个节点才读它的子文件夹', async () => {
    const dirs = dirsApi()
    const tree = useFolderTree(() => ({ dirs }), {
      cache: createFolderTreeCache(),
    })
    await tree.start()
    expect(dirs.mock.calls).toEqual([['0']])
    expect(shape(tree.rows.value)).toEqual(['根目录/', '  电影', '  剧集'])
    await tree.toggle('1')
    expect(dirs.mock.calls).toEqual([['0'], ['1']])
    expect(shape(tree.rows.value)).toEqual([
      '根目录/',
      '  电影/',
      '    2024',
      '  剧集',
    ])
    await tree.toggle('2')
    expect(shape(tree.rows.value).slice(-2)).toEqual([
      '  剧集/',
      '    (没有子文件夹)',
    ])
    // 读过且为空的节点不再显示展开箭头
    const leaf = tree.rows.value.find(r => r.type === 'dir' && r.cid === '2')
    expect(leaf).toMatchObject({ leaf: true })
  })

  it('收起再展开不重读；缓存跨实例共用，并发展开只请求一次', async () => {
    const dirs = dirsApi()
    const cache = createFolderTreeCache()
    const a = useFolderTree(() => ({ dirs }), { cache })
    await a.start()
    await Promise.all([a.toggle('1'), a.load('1')])
    await a.toggle('1')
    await a.toggle('1')
    const b = useFolderTree(() => ({ dirs }), { cache })
    await b.start()
    await b.toggle('1')
    expect(dirs.mock.calls).toEqual([['0'], ['1']])
  })

  it('缓存过期后再展开重读', async () => {
    const dirs = dirsApi()
    let now = 0
    const tree = useFolderTree(() => ({ dirs }), {
      cache: createFolderTreeCache(),
      now: () => now,
    })
    await tree.start()
    await tree.toggle('1')
    await tree.toggle('1')
    now += TREE_TTL_MS + 1
    await tree.toggle('1')
    expect(dirs.mock.calls).toEqual([['0'], ['1'], ['1']])
  })

  it('读失败在该节点下显示原因，IPC 抛错也一样', async () => {
    const dirs = vi.fn(async (cid: string) => {
      if (cid === '0')
        return {
          ok: true as const,
          cid,
          path: [],
          dirs: [{ cid: '9', name: '坏的' }],
          truncated: false,
        }
      throw new Error('IPC 断了')
    })
    const tree = useFolderTree(() => ({ dirs }), {
      cache: createFolderTreeCache(),
    })
    await tree.start()
    await tree.toggle('9')
    const note = tree.rows.value.at(-1)
    expect(note).toMatchObject({ type: 'note', tone: 'danger' })
    expect(note?.type === 'note' && note.text).toContain('IPC 断了')
  })
})

describe('转存 / 离线带上选中的文件夹', () => {
  const notify = { success: vi.fn(), error: vi.fn() }
  const folder = (): { cid: string; name: string } => ({
    cid: '200',
    name: '剧集',
  })

  it('转存把文件夹传给 receive，提示里写文件夹名', async () => {
    const receive = vi.fn(async () => ({ ok: true as const }))
    const actions = useShareActions({
      api: () => ({ receive, snap: vi.fn() }) as never,
      notify,
      clipboard: () => ({ writeText: vi.fn() }),
      folder,
    })
    await actions.save({
      title: 't',
      source: 's',
      url: 'https://115.com/s/abc',
      shareCode: 'abc',
      receiveCode: '1',
    })
    expect(receive).toHaveBeenCalledWith('https://115.com/s/abc', '1', {
      cid: '200',
      name: '剧集',
    })
    expect(notify.success).toHaveBeenCalledWith('已转存到「剧集」')
  })

  it('磁力离线把文件夹传给 offline.add', async () => {
    const link = `magnet:?xt=urn:btih:${'b'.repeat(40)}`
    const add = vi.fn(async () => ({
      ok: true as const,
      folder: '剧集',
      items: [{ link, ok: true, existed: false, hash: '', name: '' }],
    }))
    const offline = useOfflineAdd({
      api: () => ({ add }) as never,
      notify,
      openLogin: vi.fn(),
      folder,
    })
    await offline.add({
      title: 't',
      origin: 'pansou',
      source: 's',
      kind: 'magnet',
      link,
      hash: 'b'.repeat(40),
    })
    expect(add).toHaveBeenCalledWith([link], { cid: '200', name: '剧集' })
  })
})
