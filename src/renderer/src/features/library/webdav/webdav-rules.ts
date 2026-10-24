/**
 * WebDAV / Alist 源设置的纯规则：表单校验、列表文字、哪些媒体库用着某个源、远程路径的上一级。
 */
import type { LibraryInfo } from '../../../../../shared/library/ipc'
import type {
  WebDavSourceInfo,
  WebDavSourceInput,
} from '../../../../../shared/contract/webdav'
import {
  normalizeRemotePath,
  parseRemotePath,
  remotePath,
} from '../../../../../shared/webdav/remote-path'

/** 远程库只读的说明（设置分组脚注、文件夹描述共用）。 */
export const REMOTE_FOOTER =
  'WebDAV 文件夹只读：刮削结果只存在影盒里，不写 NFO 与图片、不整理文件；不会自动发现变化，NAS 上加了片子后点「扫描」。Alist 填它的 WebDAV 地址（通常是 http://地址:5244/dav）。'

/** 源表单（渲染层编辑用的普通对象）。 */
export interface SourceForm {
  id?: string
  name: string
  url: string
  username: string
  password: string
}

/** 空表单；编辑已有源时带上它的字段（密码留空表示不改）。 */
export function sourceForm(info?: WebDavSourceInfo): SourceForm {
  return info
    ? {
        id: info.id,
        name: info.name,
        url: info.url,
        username: info.username,
        password: '',
      }
    : { name: '', url: '', username: '', password: '' }
}

/** 表单问题；没问题返回 null。 */
export function sourceFormError(form: SourceForm): string | null {
  const url = form.url.trim()
  if (!url) return '请填写地址'
  if (!/^https?:\/\/[^/?#\s]+/i.test(url))
    return '地址要以 http:// 或 https:// 开头'
  if (/^https?:\/\/[^/]*@/i.test(url))
    return '用户名和密码分开填，不要写在地址里'
  return null
}

/** 表单 → 契约入参；密码留空不传（保留原密码）。 */
export function sourceInput(form: SourceForm): WebDavSourceInput {
  return {
    ...(form.id ? { id: form.id } : {}),
    name: form.name.trim(),
    url: form.url.trim(),
    username: form.username.trim(),
    ...(form.password ? { password: form.password } : {}),
  }
}

/** 源列表的说明文字：地址 · 用户名（或匿名）。 */
export function sourceDescription(info: WebDavSourceInfo): string {
  const who = info.username ? info.username : '匿名访问'
  return `${info.url} · ${who}`
}

/** 用着这个源的媒体库。 */
export function librariesUsing(
  libraries: readonly LibraryInfo[],
  sourceId: string
): LibraryInfo[] {
  return libraries.filter(
    lib => parseRemotePath(lib.root)?.sourceId === sourceId
  )
}

/** 远程路径的上一级；已经是根目录返回 null。 */
export function parentPath(path: string): string | null {
  const normalized = normalizeRemotePath(path)
  if (normalized === '/') return null
  return normalized.slice(0, normalized.lastIndexOf('/')) || '/'
}

/** 选中的远程文件夹 → 添加媒体库的根目录与默认名字（文件夹名，根目录用源名）。 */
export function remoteLibraryTarget(
  source: Pick<WebDavSourceInfo, 'id' | 'name'>,
  path: string
): { root: string; name: string } {
  const normalized = normalizeRemotePath(path)
  const name =
    normalized === '/'
      ? source.name
      : normalized.slice(normalized.lastIndexOf('/') + 1)
  return { root: remotePath(source.id, normalized), name }
}
