/**
 * 判断媒体库根目录是否在“文件系统事件不可靠”的文件系统上。
 *
 * Linux 的 inotify 只报告本机内核看到的改动：NFS / SMB(CIFS) 挂载上别的机器写入的文件不产生事件；
 * FUSE（rclone、sshfs、mergerfs 等）与 9p / virtiofs（WSL2、Docker Desktop 的目录共享）事件
 * 要么没有、要么不完整。这些文件系统上只靠定时增量扫描。
 *
 * 用 statfs 的 f_type 魔数判断（见 Linux statfs(2) / linux/magic.h）。其他系统的 f_type 编号不同、
 * 也不稳定，一律返回 false：Windows 的 ReadDirectoryChangesW 对 SMB 共享基本可用，macOS 上的
 * 网络卷由定时扫描兜底。
 */
import { statfs } from 'node:fs/promises'

/** 事件不可靠的文件系统：f_type 魔数 → 名称。 */
export const UNRELIABLE_FS_TYPES: ReadonlyMap<number, string> = new Map([
  [0x6969, 'nfs'],
  [0xff534d42, 'cifs'],
  [0xfe534d42, 'smb2'],
  [0x517b, 'smb'],
  [0x65735546, 'fuse'],
  [0x01021997, '9p'],
  [0x6a656a63, 'virtiofs'],
  [0x47504653, 'gpfs'],
  [0x0bd00bd0, 'lustre'],
  [0x564c, 'ncp'],
  [0x73757245, 'coda'],
  [0x5346414f, 'afs'],
])

/** f_type 对应的“事件不可靠”文件系统名；可靠时返回 undefined。 */
export function unreliableFsName(type: number): string | undefined {
  // statfs 在部分平台上把 f_type 当有符号数返回，统一成无符号再查
  return UNRELIABLE_FS_TYPES.get(type >>> 0)
}

/**
 * 根目录所在文件系统事件不可靠时返回它的名字（nfs / cifs / fuse …），否则 undefined。
 * 非 Linux 或 statfs 失败时返回 undefined（按可靠处理，由定时扫描兜底）。
 */
export async function detectUnreliableFs(
  root: string,
  platform: NodeJS.Platform = process.platform
): Promise<string | undefined> {
  if (platform !== 'linux') return undefined
  try {
    return unreliableFsName((await statfs(root)).type)
  } catch {
    return undefined
  }
}
