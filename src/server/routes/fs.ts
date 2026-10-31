/**
 * 目录浏览：网页端没有系统文件对话框，添加媒体库时用它在媒体根目录里逐级选文件夹。
 * 只列子目录（不列文件），跳过隐藏目录；不带 path 时列出全部根目录。
 *
 * 读失败必须打日志并回 JSON 错误。以前 readdir 的异常会冒泡成纯文本 500，
 * 网页端只能显示「读取目录失败（HTTP 500）」。
 */
import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { DirectoryListing } from '../../shared/library/ipc'
import { type Router, fail, json } from '../http/router'
import { resolveWithinRoots } from './roots'

/** 单个目录最多返回多少个子目录（防止巨型目录拖慢页面）。 */
const MAX_DIRS = 2000

/** 带目录路径和系统错误码的读取失败。 */
export class DirectoryReadError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly path: string
  ) {
    super(message)
    this.name = 'DirectoryReadError'
  }
}

type EntryKind = 'dir' | 'file' | 'other'

interface ListedEntry {
  name: string
  kind: EntryKind
}

/** 把文件系统错误译成给网页看的说明。权限问题要指出 PUID / 挂载，而不是只写 HTTP 500。 */
export function directoryReadError(
  path: string,
  error: unknown
): DirectoryReadError {
  const err = error as NodeJS.ErrnoException
  const code = err.code ?? 'ERROR'
  const detail = err.message ?? String(error)
  if (code === 'ENOENT' || code === 'ENOTDIR')
    return new DirectoryReadError(404, code, `目录不存在：${path}`, path)
  if (code === 'EACCES' || code === 'EPERM')
    return new DirectoryReadError(
      403,
      code,
      `没有权限读取 ${path}（${code}）。请把容器的 PUID 设成该目录的属主，或让目录对服务进程所属的用户组可读、可进入，并确认媒体目录已挂载到容器内的这个路径。`,
      path
    )
  return new DirectoryReadError(
    500,
    code,
    `读取目录失败：${path}（${code} ${detail}）`,
    path
  )
}

/** 目录本身读不了（不存在、没权限）时换读法也没用，直接抛给路由。 */
function isTerminalFsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return (
    code === 'ENOENT' ||
    code === 'ENOTDIR' ||
    code === 'EACCES' ||
    code === 'EPERM'
  )
}

/**
 * 先带文件类型读。NFS / SMB / FUSE 上 withFileTypes 可能抛 ENOTSUP、EINVAL、EOVERFLOW，
 * 这时退回只读名字，后面再 stat（也能认出符号链接指向的目录）。
 */
async function readEntries(dir: string): Promise<ListedEntry[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.map(entry => ({
      name: entry.name,
      kind: entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other',
    }))
  } catch (error) {
    if (isTerminalFsError(error)) throw directoryReadError(dir, error)
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (again) {
      throw directoryReadError(dir, again)
    }
    return names.map(name => ({ name, kind: 'other' as const }))
  }
}

/** 根目录要能读、能进入，并且是文件夹。失败抛 DirectoryReadError。 */
async function assertReadableRoot(root: string): Promise<void> {
  try {
    await access(root, constants.R_OK | constants.X_OK)
    const info = await stat(root)
    if (!info.isDirectory())
      throw Object.assign(new Error(`${root} 不是目录`), { code: 'ENOTDIR' })
  } catch (error) {
    if (error instanceof DirectoryReadError) throw error
    throw directoryReadError(root, error)
  }
}

/**
 * 符号链接和 d_type 未知的项：跟随链接后必须仍在媒体根目录里，才当作子目录。
 * 断链、没权限、指到根目录外的链接都跳过，不让一条坏项弄垮整个列表。
 */
async function linkedDirectory(
  dir: string,
  name: string,
  roots: readonly string[]
): Promise<string | null> {
  const path = join(dir, name)
  const resolved = await resolveWithinRoots(path, roots).catch(() => null)
  if (!resolved) return null
  try {
    const info = await stat(resolved)
    return info.isDirectory() ? path : null
  } catch {
    return null
  }
}

/** 启动时检查一个媒体根目录；读不了时返回要打进日志的说明，读得了返回 null。 */
export async function mediaRootAccessError(
  root: string
): Promise<string | null> {
  try {
    await assertReadableRoot(root)
    return null
  } catch (error) {
    const failure =
      error instanceof DirectoryReadError
        ? error
        : directoryReadError(root, error)
    const uid = process.getuid?.()
    const gid = process.getgid?.()
    return `${failure.message}（进程 uid=${uid ?? '?'} gid=${gid ?? '?'}）`
  }
}

/** 列出目录；不在根目录内返回 null。读失败抛 DirectoryReadError。 */
export async function listDirectory(
  path: string | null,
  roots: readonly string[],
  log: (message: string) => void = () => {}
): Promise<DirectoryListing | null> {
  if (!path) {
    const dirs: DirectoryListing['dirs'] = []
    const failures: DirectoryReadError[] = []
    for (const root of roots) {
      try {
        await assertReadableRoot(root)
        dirs.push({ name: basename(root) || root, path: root })
      } catch (error) {
        const failure =
          error instanceof DirectoryReadError
            ? error
            : directoryReadError(root, error)
        failures.push(failure)
        log(
          `媒体根目录不可用 path=${failure.path} code=${failure.code} ${failure.message}`
        )
      }
    }
    if (!dirs.length && failures[0]) throw failures[0]
    return { path: null, parent: null, dirs }
  }

  let resolved: string | null
  try {
    resolved = await resolveWithinRoots(path, roots)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw directoryReadError(path, error)
  }
  if (!resolved) return null

  const entries = await readEntries(resolved)
  const dirs: DirectoryListing['dirs'] = []
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('.') || entry.kind === 'file')
      continue
    const child =
      entry.kind === 'dir'
        ? join(resolved, entry.name)
        : await linkedDirectory(resolved, entry.name, roots)
    if (child) dirs.push({ name: entry.name, path: child })
  }
  dirs.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  )
  const shown = dirs.slice(0, MAX_DIRS)
  const up = dirname(resolved)
  const parent =
    up !== resolved && (await resolveWithinRoots(up, roots).catch(() => null))
      ? up
      : null
  return { path: resolved, parent, dirs: shown }
}

/** 登记目录浏览路由。 */
export function registerFsRoutes(
  router: Router,
  mediaRoots: readonly string[],
  log: (message: string) => void = message => console.warn(`[fs] ${message}`)
): void {
  router.add('GET', '/api/fs/dirs', async (_request, { url }) => {
    const raw = url.searchParams.get('path') || null
    try {
      const listing = await listDirectory(raw, mediaRoots, log)
      return listing ? json(listing) : fail(404, '目录不存在或不在媒体根目录内')
    } catch (error) {
      const failure =
        error instanceof DirectoryReadError
          ? error
          : directoryReadError(
              (raw ?? mediaRoots.join('、')) || '(未配置)',
              error
            )
      log(
        `读取目录失败 path=${failure.path} code=${failure.code} status=${failure.status} ${failure.message}`
      )
      return fail(failure.status, failure.message)
    }
  })
}
