import { execFile } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const unescapePath = (path: string): string =>
  path.replace(/\\([0-7]{3})/g, (_, code: string) =>
    String.fromCharCode(parseInt(code, 8))
  )

/** 系统挂载点及其文件系统类型，包含覆盖 SMB 子目录的其他挂载。 */
export interface MountPoint {
  path: string
  smb: boolean
}

/** 解析系统挂载表，保留非 SMB 挂载以判断子目录的实际文件系统。 */
export function parseMountTable(table: string, platform: string): MountPoint[] {
  return table.split('\n').flatMap(line => {
    if (platform === 'linux') {
      const [fields, filesystem] = line.split(' - ')
      const mount = fields?.split(' ')[4]
      return mount && filesystem
        ? [{ path: unescapePath(mount), smb: /^(cifs|smb3) /.test(filesystem) }]
        : []
    }
    const match = / on (.+) \(([^,)]*)[,)]/.exec(line)
    return match
      ? [{ path: unescapePath(match[1]), smb: match[2] === 'smbfs' }]
      : []
  })
}

/** 指定目录必须位于一个当前挂载的 SMB 文件系统内。 */
export function isOnSmbMount(
  path: string,
  mounts: readonly MountPoint[]
): boolean {
  const dir = posix.normalize(path)
  const covering = mounts.filter(
    mount =>
      mount.path === '/' ||
      dir === mount.path ||
      dir.startsWith(`${mount.path}/`)
  )
  const closest = covering.reduce<MountPoint | undefined>(
    (best, mount) =>
      !best || mount.path.length >= best.path.length ? mount : best,
    undefined
  )
  return closest?.smb === true
}

/** Windows 目录选择器的映射盘转换为 UNC；本地盘拒绝作为 SMB 添加。 */
export async function resolveMappedShare(path: string): Promise<string> {
  const match = /^([a-z]):[\\/]/i.exec(path.trim())
  if (!match) return path
  const drive = `${match[1].toUpperCase()}:`
  const { stdout } = await execute(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); (Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'").ProviderName`,
    ],
    { windowsHide: true, timeout: 5000 }
  )
  const root = stdout.trim()
  if (!root.startsWith('\\\\'))
    throw new Error('请选择网络共享，不能将本地磁盘作为 SMB 添加')
  return win32.join(root, path.trim().slice(3))
}

/** 检查 SMB 挂载表，而非仅检查卸载后可能仍存在的空目录。 */
export async function assertSmbMounted(
  path: string,
  platform: string
): Promise<void> {
  if (platform === 'win32') return
  const resolved = await realpath(path)
  const table =
    platform === 'linux'
      ? await readFile('/proc/self/mountinfo', 'utf8')
      : platform === 'darwin'
        ? (await execute('/sbin/mount', [], { timeout: 5000 })).stdout
        : ''
  if (!isOnSmbMount(resolved, parseMountTable(table, platform)))
    throw new Error('此目录不是已挂载的 SMB 共享，请先在系统中连接 NAS')
}
