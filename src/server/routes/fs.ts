/**
 * 目录浏览：网页端没有系统文件对话框，添加媒体库时用它在媒体根目录里逐级选文件夹。
 * 只列子目录（不列文件），跳过隐藏目录；不带 path 时列出全部根目录。
 */
import { readdir } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { DirectoryListing } from '../../shared/library/ipc'
import { type Router, fail, json } from '../http/router'
import { resolveWithinRoots } from './roots'

/** 单个目录最多返回多少个子目录（防止巨型目录拖慢页面）。 */
const MAX_DIRS = 2000

/** 列出目录；不在根目录内返回 null。 */
export async function listDirectory(
  path: string | null,
  roots: readonly string[]
): Promise<DirectoryListing | null> {
  if (!path)
    return {
      path: null,
      parent: null,
      dirs: roots.map(root => ({ name: basename(root) || root, path: root })),
    }
  const resolved = await resolveWithinRoots(path, roots).catch(() => null)
  if (!resolved) return null
  const entries = await readdir(resolved, { withFileTypes: true })
  const dirs = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ name: entry.name, path: join(resolved, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .slice(0, MAX_DIRS)
  const up = dirname(resolved)
  const parent =
    up !== resolved && (await resolveWithinRoots(up, roots).catch(() => null))
      ? up
      : null
  return { path: resolved, parent, dirs }
}

/** 登记目录浏览路由。 */
export function registerFsRoutes(
  router: Router,
  mediaRoots: readonly string[]
): void {
  router.add('GET', '/api/fs/dirs', async (_request, { url }) => {
    const listing = await listDirectory(
      url.searchParams.get('path') || null,
      mediaRoots
    )
    return listing ? json(listing) : fail(404, '目录不存在或不在媒体根目录内')
  })
}
