import { describe, expect, it } from 'vitest'
import { MountStore, normalizeMountPath } from '../src/main/storage/mount-store'

describe('系统共享存储', () => {
  it('Windows 只接受 UNC 共享，不接收设备路径或本地文件', () => {
    expect(normalizeMountPath(' \\\\nas\\Movies\\ ', 'win32')).toBe(
      '\\\\nas\\Movies'
    )
    expect(normalizeMountPath('\\\\192.168.1.10\\Movies', 'win32')).toBe(
      '\\\\192.168.1.10\\Movies'
    )
    for (const path of [
      'C:\\Movies',
      '\\\\?\\C:\\Movies',
      '\\\\.\\pipe\\test',
      '\\\\nas',
      'smb://nas/Movies',
    ]) {
      expect(() => normalizeMountPath(path, 'win32')).toThrow()
    }
    expect(normalizeMountPath('/mnt/media/', 'linux')).toBe('/mnt/media')
    expect(() => normalizeMountPath('relative', 'linux')).toThrow()
  })

  function fixture(): { store: MountStore; fail(): void } {
    let disk: string | null = null
    let failWrite = false
    const store = new MountStore(
      {
        read: async () => disk,
        write: async text => {
          if (failWrite) throw new Error('disk full')
          disk = text
        },
      },
      async path => {
        if (path.includes('missing')) throw new Error('共享不可读')
      },
      'win32'
    )
    return {
      store,
      fail: () => {
        failWrite = true
      },
    }
  }

  it('并发保存不丢失共享，重复路径不产生重复记录', async () => {
    const { store } = fixture()
    await Promise.all([
      store.save({ name: '电影', path: '\\\\nas\\Movies' }),
      store.save({ name: '剧集', path: '\\\\nas\\TV' }),
    ])
    expect(await store.list()).toHaveLength(2)
    const first = (await store.list())[0]
    await store.save({ name: '家庭电影', path: '\\\\NAS\\movies' })
    expect(await store.list()).toHaveLength(2)
    expect((await store.list()).find(item => item.id === first.id)?.name).toBe(
      '家庭电影'
    )
  })

  it('不可读目录不保存，写盘失败保留原记录', async () => {
    const { store, fail } = fixture()
    await expect(
      store.save({ name: '', path: '\\\\nas\\missing' })
    ).rejects.toThrow('共享不可读')
    expect(await store.list()).toEqual([])
    await store.save({ name: '电影', path: '\\\\nas\\Movies' })
    fail()
    await expect(
      store.save({ name: '剧集', path: '\\\\nas\\TV' })
    ).rejects.toThrow('disk full')
    expect(await store.list()).toHaveLength(1)
  })

  it('移除只删除连接记录，编辑不存在的记录会报错', async () => {
    const { store } = fixture()
    const mount = await store.save({ name: '电影', path: '\\\\nas\\Movies' })
    await store.remove(mount.id)
    expect(await store.list()).toEqual([])
    await expect(store.save({ ...mount })).rejects.toThrow('已经被移除')
  })
})
