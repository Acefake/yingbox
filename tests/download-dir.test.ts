import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_DOWNLOAD_FOLDER,
  chooseDownloadDir,
  migrateLegacyConfig,
  resolveDownloadDir,
} from '../src/main/download-dir'
import type { SecretCodec } from '../src/main/settings/secrets'
import {
  type SettingsStore,
  openSettingsStore,
} from '../src/main/settings/store'
import { settings } from '../src/shared/contract/settings'
import {
  type SettingChange,
  defaultValues,
  parseSetting,
} from '../src/shared/settings/schema'

const codec: SecretCodec = {
  available: () => false,
  encrypt: () => '',
  decrypt: () => '',
}

let dir: string
let changes: SettingChange[]
let store: SettingsStore

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'yingbox-download-dir-'))
  changes = []
  store = await openSettingsStore({
    file: join(dir, 'settings.json'),
    codec,
    onChange: change => changes.push(change),
  })
})

const onDisk = (): Record<string, unknown> => {
  return (
    JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as {
      values: Record<string, unknown>
    }
  ).values
}

describe('设置项 download.dir', () => {
  it('默认空串（= 默认目录）', () => {
    expect(defaultValues()['download.dir']).toBe('')
  })

  it('接受空串与绝对路径（盘符 / UNC / POSIX），去掉首尾空白', () => {
    for (const path of [
      'C:\\Videos\\yb',
      'd:/下载',
      '\\\\nas\\share\\av',
      '/Users/s/Movies',
    ])
      expect(parseSetting('download.dir', path)?.value).toBe(path)
    expect(parseSetting('download.dir', '  /tmp/a  ')?.value).toBe('/tmp/a')
    expect(parseSetting('download.dir', '   ')?.value).toBe('')
  })

  it('拒绝相对路径、只有盘符、带换行或 NUL、非字符串、超长', () => {
    for (const raw of [
      'downloads',
      './a',
      'C:',
      'C:a',
      '/a\nb',
      '/a\0b',
      42,
      null,
      `/${'a'.repeat(4096)}`,
    ])
      expect(parseSetting('download.dir', raw)).toBeUndefined()
  })

  it('IPC 边界：settings.set 写相对路径被契约拒绝', () => {
    expect(() =>
      settings.calls.set.parse(['download.dir', 'relative/dir'])
    ).toThrow('download.dir')
    expect(settings.calls.set.parse(['download.dir', '/ok'])).toEqual([
      'download.dir',
      '/ok',
    ])
  })
})

describe('resolveDownloadDir', () => {
  it('未设置时用「视频/影盒下载」，设置了就用设置值', () => {
    expect(DEFAULT_DOWNLOAD_FOLDER).toBe('影盒下载')
    expect(resolveDownloadDir('', '/home/s/Videos')).toBe(
      join('/home/s/Videos', '影盒下载')
    )
    expect(resolveDownloadDir('/mnt/nas/av', '/home/s/Videos')).toBe(
      '/mnt/nas/av'
    )
  })
})

describe('chooseDownloadDir', () => {
  const videosDir = '/home/s/Videos'

  it('对话框默认停在当前实际目录；取消返回 null，设置不变', async () => {
    const pickFolder = vi.fn(async () => null)
    expect(await chooseDownloadDir({ store, videosDir, pickFolder })).toBeNull()
    expect(pickFolder).toHaveBeenCalledWith(join(videosDir, '影盒下载'))
    expect(store.get('download.dir')).toBe('')
    expect(changes).toEqual([])

    store.set('download.dir', '/mnt/old')
    await chooseDownloadDir({ store, videosDir, pickFolder })
    expect(pickFolder).toHaveBeenLastCalledWith('/mnt/old')
  })

  it('选中可写目录：写入设置、广播变更、落盘，返回新目录', async () => {
    const target = join(dir, '下载到这里')
    mkdirSync(target)
    const result = await chooseDownloadDir({
      store,
      videosDir,
      pickFolder: async () => target,
    })
    expect(result).toBe(target)
    expect(store.get('download.dir')).toBe(target)
    expect(changes).toEqual([{ key: 'download.dir', value: target }])
    await store.flush()
    expect(onDisk()['download.dir']).toBe(target)
  })

  it('选中的不是目录 / 不存在：抛错且不改设置', async () => {
    const file = join(dir, 'a-file')
    writeFileSync(file, 'x')
    await expect(
      chooseDownloadDir({ store, videosDir, pickFolder: async () => file })
    ).rejects.toThrow('下载路径必须是目录')
    await expect(
      chooseDownloadDir({
        store,
        videosDir,
        pickFolder: async () => join(dir, 'missing'),
      })
    ).rejects.toThrow()
    expect(store.get('download.dir')).toBe('')
    expect(changes).toEqual([])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    '选中只读目录：抛「不可写」且不改设置',
    async () => {
      const readonlyDir = join(dir, 'ro')
      mkdirSync(readonlyDir, { mode: 0o555 })
      await expect(
        chooseDownloadDir({
          store,
          videosDir,
          pickFolder: async () => readonlyDir,
        })
      ).rejects.toThrow('不可写')
      expect(store.get('download.dir')).toBe('')
    }
  )
})

describe('migrateLegacyConfig（旧 config.json）', () => {
  const configFile = (): string => join(dir, 'config.json')

  it('把 downloadPath 并入设置并删除 config.json', async () => {
    writeFileSync(configFile(), JSON.stringify({ downloadPath: '/mnt/av' }))
    await migrateLegacyConfig(store, configFile())
    expect(store.get('download.dir')).toBe('/mnt/av')
    expect(existsSync(configFile())).toBe(false)
  })

  it('设置里已有值时不覆盖，仍删除 config.json', async () => {
    store.set('download.dir', '/mnt/new')
    writeFileSync(configFile(), JSON.stringify({ downloadPath: '/mnt/old' }))
    await migrateLegacyConfig(store, configFile())
    expect(store.get('download.dir')).toBe('/mnt/new')
    expect(existsSync(configFile())).toBe(false)
  })

  it('损坏的 JSON 或不合法的路径：丢弃，回到默认目录', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const text of ['{oops', JSON.stringify({ downloadPath: 'rel/dir' })]) {
      writeFileSync(configFile(), text)
      await migrateLegacyConfig(store, configFile())
      expect(store.get('download.dir')).toBe('')
      expect(existsSync(configFile())).toBe(false)
    }
    warn.mockRestore()
  })

  it('没有 config.json：什么都不做', async () => {
    await migrateLegacyConfig(store, configFile())
    expect(store.get('download.dir')).toBe('')
    expect(changes).toEqual([])
  })
})
