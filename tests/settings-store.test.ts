import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'

import type { SecretCodec } from '../src/main/settings/secrets'
import {
  type SettingsStore,
  type SettingsStoreOptions,
  openSettingsStore,
} from '../src/main/settings/store'
import type { SettingChange } from '../src/shared/settings/schema'

/** 可逆的假编解码器：密文里不会出现明文 */
const codec: SecretCodec = {
  available: () => true,
  encrypt: plain =>
    Buffer.from(`enc:${plain}`).toString('base64').split('').reverse().join(''),
  decrypt: cipher =>
    Buffer.from(cipher.split('').reverse().join(''), 'base64')
      .toString()
      .slice(4),
}

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'yingbox-settings-'))
  file = join(dir, 'settings.json')
})

const open = (
  options: Partial<SettingsStoreOptions> = {}
): Promise<SettingsStore> => openSettingsStore({ file, codec, ...options })

const onDisk = (): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf8'))

describe('默认值', () => {
  it('没有 settings.json 时全部取 schema 默认值，且不急着建文件', async () => {
    const store = await open()
    const { values, secrets, legacyMigrated } = store.snapshot()
    expect(values['app.theme']).toBe('dark')
    expect(values['app.adultMode']).toBe(false)
    // 已删除的设置（旧刮削队列的并发数）不再出现
    expect(values).not.toHaveProperty('scrape.concurrency')
    expect(values).not.toHaveProperty('backend.url')
    expect(secrets).toEqual({
      'scrape.tmdbToken': false,
      'ai.apiKey.openai': false,
      'ai.apiKey.deepseek': false,
      'ai.apiKey.openrouter': false,
      'ai.apiKey.opencode-go': false,
      'ai.apiKey.custom': false,
      'danmaku.appSecret': false,
      'pan115.session': false,
      'notify.bark.key': false,
      'notify.telegram.token': false,
    })
    expect(legacyMigrated).toBe(false)
    expect(existsSync(file)).toBe(false)
  })

  it('文件里不合法的值被丢弃，回到默认值；合法的保留', async () => {
    writeFileSync(
      file,
      JSON.stringify({
        values: {
          'app.theme': 'purple',
          'player.playbackRate': 99,
          'scrape.concurrency': 5,
          'app.adultMode': true,
          nope: 1,
        },
      })
    )
    const store = await open()
    expect(store.get('app.theme')).toBe('dark')
    expect(store.get('player.playbackRate')).toBe(1)
    expect(store.get('app.adultMode')).toBe(true)
    // 老用户 settings.json 里已删除的键读入时丢掉，下次落盘不再写回
    expect(store.snapshot().values).not.toHaveProperty('scrape.concurrency')
    store.set('app.theme', 'light')
    await store.flush()
    expect(onDisk().values as object).not.toHaveProperty('scrape.concurrency')
  })

  it('文件损坏时用默认值继续，并备份原文件', async () => {
    writeFileSync(file, '{ not json')
    const store = await open()
    expect(store.get('app.theme')).toBe('dark')
    expect(
      readdirSync(dir).some(name => name.startsWith('settings.json.corrupt-'))
    ).toBe(true)
  })
})

describe('写入校验', () => {
  it('合法值写入内存、落盘并通知一次', async () => {
    const changes: SettingChange[] = []
    const store = await open({ onChange: change => changes.push(change) })
    store.set('app.theme', 'light')
    store.set('app.theme', 'light')
    await store.flush()
    expect(store.get('app.theme')).toBe('light')
    expect(changes).toEqual([{ key: 'app.theme', value: 'light' }])
    expect(onDisk()).toMatchObject({
      version: 1,
      values: { 'app.theme': 'light' },
    })
  })

  it('未知键、类型不对、超出范围、敏感项都拒绝，状态不变', async () => {
    const store = await open()
    expect(() => store.set('nope', 1)).toThrow('不合法')
    expect(() => store.set('app.adultMode', '1')).toThrow('不合法')
    expect(() => store.set('scrape.concurrency', 3)).toThrow('不合法')
    expect(() => store.set('player.playbackRate', 5)).toThrow('不合法')
    expect(() => store.set('scrape.tmdbToken', 'x')).toThrow('不合法')
    expect(store.snapshot().values).toEqual((await open()).snapshot().values)
  })

  it('AI 服务商可选 OpenCode Go，其 Key 走密钥存储', async () => {
    const store = await open()
    store.set('ai.provider', 'opencode-go')
    await store.setSecret('ai.apiKey.opencode-go', 'oc-key')
    await store.flush()
    expect(store.get('ai.provider')).toBe('opencode-go')
    expect(store.snapshot().secrets['ai.apiKey.opencode-go']).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain('oc-key')
  })

  it('重新打开后读到上次写入的值', async () => {
    const store = await open()
    store.set('player.engine', 'mpv')
    store.set('player.playbackRate', 1.5)
    await store.flush()
    const reopened = await open()
    expect(reopened.get('player.engine')).toBe('mpv')
    expect(reopened.get('player.playbackRate')).toBe(1.5)
  })
})

describe('原子写', () => {
  it('连续快速写入后，文件是完整 JSON、等于最终状态，且不留临时文件', async () => {
    const store = await open()
    for (let i = 1; i <= 8; i++) store.set('player.playbackRate', i / 4)
    store.set('app.theme', 'light')
    await store.flush()
    expect(onDisk()).toMatchObject({
      values: { 'player.playbackRate': 2, 'app.theme': 'light' },
    })
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })
})

describe('旧 localStorage 迁移', () => {
  const legacy = {
    'yingbox-theme': 'light',
    adultMode: '1',
    preferred_player_engine: 'mpv',
    player_rtx_vsr: '0',
    player_playback_rate: '1.25',
    metadataLanguage: 'ja-JP',
    scrapeConcurrency: '6',
    imageDownloadSize_poster: 'w342',
    scrapeProviderConfig: JSON.stringify({
      provider: 'tmdb',
      tmdbAccessToken: 'tok',
      goBackendUrl: 'http://nas:31471',
      goBackendApiKey: '',
    }),
  }

  it('把旧值转换后并入，并写迁移标记', async () => {
    const store = await open()
    const snapshot = store.migrateLegacy(legacy)
    await store.flush()
    expect(snapshot.legacyMigrated).toBe(true)
    expect(snapshot.values).toMatchObject({
      'app.theme': 'light',
      'app.adultMode': true,
      'player.engine': 'mpv',
      'player.rtxVsr': false,
      'player.playbackRate': 1.25,
      'scrape.metadataLanguage': 'ja-JP',
      'scrape.imageSize.poster': 'w342',
      'scrape.imageSize.actor': 'original',
    })
    expect(snapshot.values).not.toHaveProperty('scrape.tmdbToken')
    expect(snapshot.values).not.toHaveProperty('backend.url')
    // 旧 scrapeConcurrency 已无对应设置，迁移时忽略
    expect(snapshot.values).not.toHaveProperty('scrape.concurrency')
    expect(onDisk()).toMatchObject({ legacyMigrated: true })
  })

  it('旧明文 TMDB 令牌加密成密钥：盘上没有明文，已有密钥不覆盖，密钥存储不可用时放弃', async () => {
    const store = await open()
    const snapshot = store.migrateLegacy(legacy)
    await store.flush()
    expect(snapshot.secrets['scrape.tmdbToken']).toBe(true)
    expect(store.getSecret('scrape.tmdbToken')).toBe('tok')
    expect(readFileSync(file, 'utf8')).not.toContain('"tok"')

    writeFileSync(file, JSON.stringify({ secrets: {}, legacyMigrated: false }))
    const existing = await open()
    await existing.setSecret('scrape.tmdbToken', 'new')
    existing.migrateLegacy(legacy)
    expect(existing.getSecret('scrape.tmdbToken')).toBe('new')

    writeFileSync(file, JSON.stringify({ legacyMigrated: false }))
    const locked = await open({ codec: { ...codec, available: () => false } })
    expect(locked.migrateLegacy(legacy).secrets['scrape.tmdbToken']).toBe(false)
  })

  it('幂等：已迁移后再调用不再改动任何值', async () => {
    const store = await open()
    store.migrateLegacy(legacy)
    store.set('app.theme', 'dark')
    const again = store.migrateLegacy({
      ...legacy,
      'yingbox-theme': 'light',
      adultMode: '0',
    })
    expect(again.values['app.theme']).toBe('dark')
    expect(again.values['app.adultMode']).toBe(true)

    await store.flush()
    const reopened = await open()
    expect(
      reopened.migrateLegacy({ adultMode: '0' }).values['app.adultMode']
    ).toBe(true)
  })

  it('新存储里已有的值优先，旧值只填空位；不合法的旧值跳过', async () => {
    writeFileSync(file, JSON.stringify({ values: { 'app.theme': 'dark' } }))
    const store = await open()
    const snapshot = store.migrateLegacy({
      'yingbox-theme': 'light',
      player_playback_rate: '9',
      scrapeProviderConfig: '{broken',
    })
    expect(snapshot.values['app.theme']).toBe('dark')
    expect(snapshot.values['player.playbackRate']).toBe(1)
    expect(snapshot.secrets['scrape.tmdbToken']).toBe(false)
  })
})

describe('迁移硬约束', () => {
  it('已有新值但尚未迁移：旧值一个都不覆盖（含与默认值相同的显式值），只填空位，重开后仍成立', async () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        values: {
          'app.theme': 'light',
          'app.adultMode': false,
          'player.engine': 'mpv',
          'player.playbackRate': 1.5,
        },
        legacyMigrated: false,
      })
    )
    const store = await open()
    const snapshot = store.migrateLegacy({
      'yingbox-theme': 'dark',
      adultMode: '1',
      preferred_player_engine: 'built-in',
      player_playback_rate: '2',
      player_rtx_vsr: '1',
    })
    await store.flush()
    const kept = {
      'app.theme': 'light',
      'app.adultMode': false,
      'player.engine': 'mpv',
      'player.playbackRate': 1.5,
    }
    expect(snapshot.values).toMatchObject({ ...kept, 'player.rtxVsr': true })
    expect(onDisk()).toMatchObject({
      legacyMigrated: true,
      values: { ...kept, 'player.rtxVsr': true },
    })
    expect((await open()).snapshot().values).toMatchObject(kept)
  })

  it('迁移标记阻止第二次迁移：同一会话内与重开后，旧值连空位也不再填', async () => {
    const store = await open()
    expect(store.migrateLegacy({}).legacyMigrated).toBe(true)
    const legacy = {
      'yingbox-theme': 'light',
      adultMode: '1',
      player_rtx_vsr: '1',
    }
    const again = store.migrateLegacy(legacy)
    expect(again.values['app.theme']).toBe('dark')
    expect(again.values['app.adultMode']).toBe(false)
    expect(again.values['player.rtxVsr']).toBe(false)
    await store.flush()
    expect(onDisk()).toEqual({
      version: 1,
      values: {},
      secrets: {},
      legacyMigrated: true,
    })

    const reopened = await open()
    const third = reopened.migrateLegacy(legacy)
    expect(third.values['app.theme']).toBe('dark')
    expect(third.values['app.adultMode']).toBe(false)
    expect(third.values['player.rtxVsr']).toBe(false)
  })

  it('磁盘上已有迁移标记：首次打开就不迁移', async () => {
    writeFileSync(file, JSON.stringify({ values: {}, legacyMigrated: true }))
    const store = await open()
    const snapshot = store.migrateLegacy({
      adultMode: '1',
      'yingbox-theme': 'light',
    })
    expect(snapshot.values['app.adultMode']).toBe(false)
    expect(snapshot.values['app.theme']).toBe('dark')
  })
})

describe('密钥', () => {
  it('密文落盘、明文不落盘；快照里只有「已配置」', async () => {
    const store = await open()
    await store.setSecret('scrape.tmdbToken', 'super-secret-token')
    expect(store.getSecret('scrape.tmdbToken')).toBe('super-secret-token')
    expect(store.snapshot().secrets['scrape.tmdbToken']).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain('super-secret-token')
    expect(JSON.stringify(store.snapshot())).not.toContain('super-secret-token')
    expect((await open()).getSecret('scrape.tmdbToken')).toBe(
      'super-secret-token'
    )
  })

  it('空串删除密钥', async () => {
    const store = await open()
    await store.setSecret('scrape.tmdbToken', 'abc')
    await store.setSecret('scrape.tmdbToken', '')
    expect(store.getSecret('scrape.tmdbToken')).toBe('')
    expect(store.snapshot().secrets['scrape.tmdbToken']).toBe(false)
  })

  it('系统密钥存储不可用或值含换行时拒绝，原值保留', async () => {
    const store = await open()
    await store.setSecret('scrape.tmdbToken', 'abc')
    await expect(store.setSecret('scrape.tmdbToken', 'a\nb')).rejects.toThrow(
      '不合法'
    )
    const locked = await open({ codec: { ...codec, available: () => false } })
    await expect(locked.setSecret('scrape.tmdbToken', 'next')).rejects.toThrow(
      '不可用'
    )
    expect(locked.getSecret('scrape.tmdbToken')).toBe('abc')
    expect(store.getSecret('scrape.tmdbToken')).toBe('abc')
  })
})
