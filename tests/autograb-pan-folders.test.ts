/**
 * 追更定位用的 115 文件夹能力与文件夹名（ADR-0029）。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  movieFolderName,
  seriesFolderName,
} from '../src/main/autograb/folder-name'
import { createPanFolders } from '../src/main/autograb/pan-folders'
import type { Pan115Client } from '../src/main/pan115/client'
import { Pan115Error } from '../src/main/pan115/errors'
import type { Pan115Service } from '../src/main/pan115/service'
import {
  DEFAULT_MOVIE_TEMPLATE,
  DEFAULT_TV_TEMPLATE,
} from '../src/shared/library/writer'
import type { LibraryItemNode } from '../src/shared/library/ipc'

/** 一棵假 115 目录树：cid → { 名字, 上级 } */
function fakePan(tree: Record<string, { name: string; parent: string }>): {
  pan: Pan115Service
  client: Pick<Pan115Client, 'dirs'>
  mkdir: ReturnType<typeof vi.fn>
} {
  let next = 900
  const mkdir = vi.fn(async (parent: string, name: string) => {
    const cid = String(next++)
    tree[cid] = { name, parent }
    return cid
  })
  const pathOf = (cid: string): { cid: string; name: string }[] =>
    cid === '0'
      ? [{ cid: '0', name: '' }]
      : [...pathOf(tree[cid].parent), { cid, name: tree[cid].name }]
  const client: Pick<Pan115Client, 'dirs' | 'mkdir'> = {
    dirs: async (cid: string) => {
      if (cid !== '0' && !tree[cid]) throw new Pan115Error('目录不存在', 20001)
      return {
        cid,
        path: pathOf(cid),
        dirs: Object.entries(tree)
          .filter(([, d]) => d.parent === cid)
          .map(([id, d]) => ({ cid: id, name: d.name })),
        truncated: false,
      }
    },
    mkdir,
  }
  const pan = {
    use: <T>(run: (c: Pan115Client) => Promise<T>) =>
      run(client as Pan115Client),
  } as unknown as Pan115Service
  return { pan, client, mkdir }
}

describe('createPanFolders', () => {
  const tree = (): Record<string, { name: string; parent: string }> => ({
    '1': { name: '影音库', parent: '0' },
    '2': { name: '剧集', parent: '1' },
    '3': { name: '繁花 (2023)', parent: '2' },
  })

  it('子文件夹已在就沿用，不在就建', async () => {
    const { pan, mkdir } = fakePan(tree())
    const folders = createPanFolders(pan, () => '')
    expect(await folders.childFolder('2', '繁花 (2023)')).toBe('3')
    expect(mkdir).not.toHaveBeenCalled()
    const created = await folders.childFolder('2', '漫长的季节 (2023)')
    expect(mkdir).toHaveBeenCalledWith('2', '漫长的季节 (2023)')
    expect(await folders.childFolder('2', '漫长的季节 (2023)')).toBe(created)
  })

  it('文件夹还在才算在：115 拒绝列（已删）或列出来的不是它自己都不算；网络错误照常抛出', async () => {
    const t = tree()
    const { pan, client } = fakePan(t)
    const folders = createPanFolders(pan, () => '')
    expect(await folders.folderExists('3')).toBe(true)
    delete t['3']
    expect(await folders.folderExists('3')).toBe(false)
    // 已删的 cid 被 115 当成根目录列出来
    client.dirs = async () => ({
      cid: '3',
      path: [{ cid: '0', name: '' }],
      dirs: [],
      truncated: false,
    })
    expect(await folders.folderExists('3')).toBe(false)
    client.dirs = async () => {
      throw new Error('fetch failed')
    }
    await expect(folders.folderExists('3')).rejects.toThrow('fetch failed')
  })

  it('子文件夹没列全时不新建同名文件夹，报错让用户直接选', async () => {
    const { pan, client, mkdir } = fakePan(tree())
    const list = client.dirs
    client.dirs = async cid => ({ ...(await list(cid)), truncated: true })
    const folders = createPanFolders(pan, () => '')
    await expect(folders.childFolder('2', '新剧 (2026)')).rejects.toThrow(
      '太多'
    )
    expect(mkdir).not.toHaveBeenCalled()
    // 列到了就照常沿用
    expect(await folders.childFolder('2', '繁花 (2023)')).toBe('3')
  })

  it('本地剧文件夹按 115 根目录同名换算成 cid', async () => {
    const { pan } = fakePan(tree())
    const folders = createPanFolders(pan, () => '')
    expect(await folders.folderCid('E:\\影音库\\剧集\\繁花 (2023)')).toBe('3')
    expect(await folders.folderCid('E:\\影音库\\剧集\\不存在')).toBeNull()
  })
})

describe('追更子文件夹名', () => {
  it('剧：取整理模板第一段，用片库里的 TMDB 片名与年份', () => {
    const item = {
      title: '嫁金钗',
      originalTitle: null,
      year: 2026,
      providerIds: { tmdb: '300146' },
      metadata: {
        level: 'title',
        title: '嫁金釵',
        year: 2026,
        externalIds: {},
      },
    } as unknown as LibraryItemNode
    expect(seriesFolderName(DEFAULT_TV_TEMPLATE, item, '嫁金钗')).toBe(
      '嫁金釵 (2026)'
    )
    // 不在片库：退回剧名，没年份时不留空括号
    expect(seriesFolderName(DEFAULT_TV_TEMPLATE, null, '繁花')).toBe('繁花')
  })

  it('电影：取整理模板第一段；模板只有一段时没有子文件夹', () => {
    const movie = { title: '希望', year: 2026, tmdbId: 1 }
    expect(movieFolderName(DEFAULT_MOVIE_TEMPLATE, movie)).toBe('希望 (2026)')
    expect(movieFolderName('{title} ({year}).{ext}', movie)).toBeNull()
  })
})
