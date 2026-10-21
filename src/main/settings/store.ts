/**
 * 设置存储：userData/settings.json 的唯一读写者。
 *
 * - 读取：文件里的每个值都按 schema 重新校验，不合法的丢弃回默认值；文件损坏时整份回退默认并备份原文件。
 * - 写入：内存先更新（同步），落盘经 atomicWrite 串行排队，崩溃时文件要么是旧版要么是新版。
 * - 变更：每次成功写入一个值都通过 onChange 通知（由调用方广播给所有窗口）。
 * - 迁移：首启把旧 localStorage 值并入，已有值不覆盖，完成后写标记；重复调用无副作用。
 */
import { promises as fs } from 'node:fs'
import { atomicWrite } from '../file-operations'
import {
  type LegacySettings,
  fromLegacy,
  legacySecrets,
} from '../../shared/settings/legacy'
import {
  type SecretKey,
  type SettingChange,
  type SettingValue,
  type SettingValues,
  type SettingsSnapshot,
  type ValueKey,
  defaultValues,
  parseSetting,
  secretKeys,
  settingsSchema,
} from '../../shared/settings/schema'
import type { SecretCodec } from './secrets'

/** settings.json 的结构 */
interface SettingsFile {
  version: 1
  /** 只记用户改过的值；缺省即默认值 */
  values: Partial<SettingValues>
  /** 敏感项的 base64 密文 */
  secrets: Partial<Record<SecretKey, string>>
  /** 旧 localStorage 设置是否已迁移 */
  legacyMigrated: boolean
}

/** 打开设置存储的参数 */
export interface SettingsStoreOptions {
  /** settings.json 的绝对路径 */
  file: string
  /** 敏感项编解码器 */
  codec: SecretCodec
  /** 值变更回调 */
  onChange?: (change: SettingChange) => void
}

/** 设置存储 */
export interface SettingsStore {
  /** 当前快照（渲染层启动时同步获取） */
  snapshot(): SettingsSnapshot
  /** 读一个普通设置 */
  get<K extends ValueKey>(key: K): SettingValue<K>
  /** 写一个普通设置；键不存在或值不合法时抛错 */
  set(key: string, raw: unknown): SettingChange
  /** 并入旧 localStorage 设置（幂等），返回迁移后的快照 */
  migrateLegacy(legacy: LegacySettings): SettingsSnapshot
  /** 读一个密钥的明文；未设置或无法解密时为空串 */
  getSecret(key: SecretKey): string
  /** 写一个密钥（空串表示删除），等落盘完成后返回 */
  setSecret(key: SecretKey, value: string): Promise<void>
  /** 等待已排队的写入全部落盘 */
  flush(): Promise<void>
}

function emptyFile(): SettingsFile {
  return { version: 1, values: {}, secrets: {}, legacyMigrated: false }
}

/** 把磁盘上的未知 JSON 解析为可信结构：逐项校验，不合法的丢掉 */
function parseSettingsFile(raw: unknown): SettingsFile {
  const file = emptyFile()
  if (!raw || typeof raw !== 'object') return file
  const data = raw as Record<string, unknown>
  const values =
    data.values && typeof data.values === 'object' ? data.values : {}
  for (const [key, value] of Object.entries(
    values as Record<string, unknown>
  )) {
    const change = parseSetting(key, value)
    if (change)
      (file.values as Record<string, unknown>)[change.key] = change.value
  }
  const secrets =
    data.secrets && typeof data.secrets === 'object' ? data.secrets : {}
  for (const key of secretKeys) {
    const cipher = (secrets as Record<string, unknown>)[key]
    if (typeof cipher === 'string' && cipher) file.secrets[key] = cipher
  }
  file.legacyMigrated = data.legacyMigrated === true
  return file
}

async function readSettingsFile(path: string): Promise<SettingsFile> {
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyFile()
    throw error
  }
  try {
    return parseSettingsFile(JSON.parse(text))
  } catch {
    // 文件损坏：留一份原文便于排查，然后按默认值继续
    const backup = `${path}.corrupt-${Date.now()}`
    await fs.copyFile(path, backup).catch(() => {})
    console.warn(
      `[settings] settings.json 无法解析，已备份到 ${backup}，改用默认设置`
    )
    return emptyFile()
  }
}

/** 打开（或首次创建）设置存储 */
export async function openSettingsStore(
  options: SettingsStoreOptions
): Promise<SettingsStore> {
  const { file: path, codec, onChange } = options
  const state = await readSettingsFile(path)
  let writing: Promise<void> = Promise.resolve()

  /** 排队落盘最新状态；返回本次写入完成的 Promise */
  const persist = (): Promise<void> => {
    const next = writing.then(() =>
      atomicWrite(path, JSON.stringify(state, null, 2))
    )
    writing = next.catch(error =>
      console.error('[settings] 写入 settings.json 失败', error)
    )
    return next
  }

  const values = (): SettingValues => ({ ...defaultValues(), ...state.values })

  const snapshot = (): SettingsSnapshot => ({
    values: values(),
    secrets: Object.fromEntries(
      secretKeys.map(key => [key, Boolean(state.secrets[key])])
    ) as Record<SecretKey, boolean>,
    legacyMigrated: state.legacyMigrated,
  })

  return {
    snapshot,

    get: key => values()[key],

    set(key, raw) {
      const change = parseSetting(key, raw)
      if (!change) throw new Error(`设置 ${key} 的值不合法`)
      const current = values()[change.key]
      if (current === change.value) return change
      ;(state.values as Record<string, unknown>)[change.key] = change.value
      void persist()
      onChange?.(change)
      return change
    },

    migrateLegacy(legacy) {
      if (state.legacyMigrated) return snapshot()
      for (const [key, value] of Object.entries(fromLegacy(legacy))) {
        // 已经在新存储里设置过的值优先，旧值只填空位
        if (!(key in state.values))
          (state.values as Record<string, unknown>)[key] = value
      }
      // 旧明文密钥（TMDB 令牌）：加密后填空位；系统密钥存储不可用时放弃，不落明文
      if (codec.available()) {
        for (const [key, plain] of Object.entries(legacySecrets(legacy)) as Array<
          [SecretKey, string]
        >) {
          if (!state.secrets[key]) state.secrets[key] = codec.encrypt(plain)
        }
      }
      state.legacyMigrated = true
      void persist()
      return snapshot()
    },

    getSecret(key) {
      const cipher = state.secrets[key]
      if (!cipher) return ''
      try {
        return codec.decrypt(cipher)
      } catch (error) {
        console.warn(`[settings] 密钥 ${key} 无法解密`, error)
        return ''
      }
    },

    async setSecret(key, value) {
      const plain = settingsSchema[key].parse(value)
      if (plain === undefined) throw new Error(`密钥 ${key} 的值不合法`)
      const previous = state.secrets[key]
      if (plain) {
        if (!codec.available())
          throw new Error('系统密钥存储不可用，无法安全保存')
        state.secrets[key] = codec.encrypt(plain)
      } else delete state.secrets[key]
      try {
        await persist()
      } catch (error) {
        if (previous === undefined) delete state.secrets[key]
        else state.secrets[key] = previous
        throw error
      }
    },

    flush: () => writing,
  }
}
