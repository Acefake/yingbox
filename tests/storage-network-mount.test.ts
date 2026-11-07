import { describe, expect, it } from 'vitest'
import {
  isOnSmbMount,
  parseMountTable,
} from '../src/main/storage/network-mount'

describe('SMB 共享挂载检查', () => {
  it('Linux 只识别 SMB 文件系统，并解码路径里的空格', () => {
    const table = [
      '23 1 0:1 / / rw - ext4 /dev/sda rw',
      '24 1 0:2 / /mnt/My\\040NAS rw - cifs //nas/Movies rw',
      '25 1 0:3 / /mnt/TV rw - smb3 //nas/TV rw',
    ].join('\n')
    expect(parseMountTable(table, 'linux')).toEqual([
      { path: '/', smb: false },
      { path: '/mnt/My NAS', smb: true },
      { path: '/mnt/TV', smb: true },
    ])
  })
  it('macOS 只识别实际 smbfs 挂载', () => {
    expect(
      parseMountTable(
        '//user@nas/Movies on /Volumes/Movies (smbfs, nodev)\n/dev/disk1 on / (apfs, local)',
        'darwin'
      )
    ).toEqual([
      { path: '/Volumes/Movies', smb: true },
      { path: '/', smb: false },
    ])
  })
  it('卸载后留下的目录、同名前缀和跳出共享的路径均不通过', () => {
    expect(
      isOnSmbMount('/mnt/Movies/sub', [{ path: '/mnt/Movies', smb: true }])
    ).toBe(true)
    expect(isOnSmbMount('/mnt/Movies', [])).toBe(false)
    expect(
      isOnSmbMount('/mnt/Movies-other', [{ path: '/mnt/Movies', smb: true }])
    ).toBe(false)
    expect(
      isOnSmbMount('/mnt/Movies/../private', [
        { path: '/mnt/Movies', smb: true },
      ])
    ).toBe(false)
  })
  it('共享子目录被本地挂载覆盖时按最长挂载点判断', () => {
    const mounts = parseMountTable(
      '24 1 0:2 / /mnt/Movies rw - cifs //nas/Movies rw\n25 24 0:3 / /mnt/Movies/local rw - tmpfs tmpfs rw',
      'linux'
    )
    expect(isOnSmbMount('/mnt/Movies/remote', mounts)).toBe(true)
    expect(isOnSmbMount('/mnt/Movies/local/sub', mounts)).toBe(false)
  })
})
