/**
 * 远程（WebDAV / Alist）媒体库的路径约定，主进程、媒体库引擎、渲染层共用。
 *
 * - 库里登记的路径（files.path / libraries.root）写成 `yingbox-dav://<源 id>/<远程路径>`，
 *   远程路径是解码后的原文（带中文、空格），和本地路径一样给文件名解析器用；
 * - 交给 <video> 的地址是同一个 scheme，但每段做百分号编码（remoteMediaUrl），
 *   主进程的 yingbox-dav 协议按它带上凭据转发，凭据不出主进程；
 * - 源 id 是小写字母数字（URL 的 host 会被转小写，这里统一小写免得对不上）。
 */

/** 远程媒体的 scheme（也是主进程注册的协议名）。 */
export const REMOTE_SCHEME = 'yingbox-dav'

const PREFIX = `${REMOTE_SCHEME}://`

/** 源 id 的格式：小写字母数字，1–32 位。 */
export const SOURCE_ID_RE = /^[a-z0-9]{1,32}$/

/** 路径是否在远程源上。 */
export function isRemotePath(path: string): boolean {
  return path.startsWith(PREFIX)
}

/** 规范远程路径：正斜杠、以 / 开头、合并重复斜杠、去掉结尾斜杠（根目录是 /）。 */
export function normalizeRemotePath(path: string): string {
  const joined = `/${path}`.replace(/\\/g, '/').replace(/\/+/g, '/')
  return joined.length > 1 ? joined.replace(/\/$/, '') : '/'
}

/** 拼库里登记用的路径：`yingbox-dav://<id>/<path>`；根目录不带结尾斜杠。 */
export function remotePath(sourceId: string, path: string): string {
  const normalized = normalizeRemotePath(path)
  return `${PREFIX}${sourceId}${normalized === '/' ? '' : normalized}`
}

/** 拆开库里的远程路径；不是远程路径或源 id 不合法时返回 null。 */
export function parseRemotePath(
  value: string
): { sourceId: string; path: string } | null {
  if (!isRemotePath(value)) return null
  const rest = value.slice(PREFIX.length)
  const slash = rest.indexOf('/')
  const sourceId = slash < 0 ? rest : rest.slice(0, slash)
  if (!SOURCE_ID_RE.test(sourceId)) return null
  const path = normalizeRemotePath(slash < 0 ? '/' : rest.slice(slash))
  if (path.split('/').includes('..')) return null
  return {
    sourceId,
    path,
  }
}

/** 远程目录下的子项路径（库里登记用的写法）。 */
export function joinRemote(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

/** 远程路径按段百分号编码（`/电影/A B` → `/%E7%94%B5%E5%BD%B1/A%20B`），斜杠保留。 */
export function encodeRemotePath(path: string): string {
  return normalizeRemotePath(path)
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

/** 库里的远程路径 → 播放器可加载的地址（同 scheme，路径编码）；不是远程路径返回 null。 */
export function remoteMediaUrl(value: string): string | null {
  const parsed = parseRemotePath(value)
  if (!parsed) return null
  return `${PREFIX}${parsed.sourceId}${encodeRemotePath(parsed.path)}`
}

/** 播放器地址 → 源 id 与解码后的远程路径；格式不对返回 null。 */
export function parseRemoteMediaUrl(
  url: string
): { sourceId: string; path: string } | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${REMOTE_SCHEME}:`) return null
  if (!SOURCE_ID_RE.test(parsed.host)) return null
  let path: string
  try {
    path = normalizeRemotePath(
      parsed.pathname.split('/').map(decodeURIComponent).join('/')
    )
  } catch {
    return null
  }
  // 解码后再出现 .. 段视为非法，不让地址跳出源的根目录
  if (path.split('/').some(segment => segment === '..')) return null
  return { sourceId: parsed.host, path: normalizeRemotePath(path) }
}
