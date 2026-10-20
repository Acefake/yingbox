/**
 * 唯一设置定义：加一个设置项只改这里。
 *
 * 每项声明类型、默认值、合法范围，以及是否敏感。
 * 主进程（store）用 parse 校验写入；渲染层（useSetting）从这里推导值的类型。
 * 敏感项（secret）只存在主进程的 safeStorage 里，渲染层的快照里只有「是否已配置」。
 *
 * 本文件被 sandboxed preload 间接打包，只能依赖纯 TS。
 */

interface SpecBase<T> {
  /** 未设置时的值 */
  readonly default: T
  /** 把未知输入解析为合法值；不合法返回 undefined */
  readonly parse: (raw: unknown) => T | undefined
}

/** 普通设置项：值存在 settings.json，渲染层可读写 */
interface ValueSpec<T> extends SpecBase<T> {
  readonly kind: 'value'
}

/** 敏感设置项：值经 safeStorage 加密存放，只有主进程能读 */
interface SecretSpec extends SpecBase<string> {
  readonly kind: 'secret'
}

/** 布尔开关 */
function bool(fallback: boolean): ValueSpec<boolean> {
  return {
    kind: 'value',
    default: fallback,
    parse: raw => (typeof raw === 'boolean' ? raw : undefined),
  }
}

/** [min, max] 内的整数 */
function int(
  min: number,
  max: number,
  fallback: number
): ValueSpec<number> {
  return {
    kind: 'value',
    default: fallback,
    parse: raw =>
      Number.isSafeInteger(raw) &&
      (raw as number) >= min &&
      (raw as number) <= max
        ? (raw as number)
        : undefined,
  }
}

/** [min, max] 内的有限数字 */
function num(
  min: number,
  max: number,
  fallback: number
): ValueSpec<number> {
  return {
    kind: 'value',
    default: fallback,
    parse: raw =>
      typeof raw === 'number' &&
      Number.isFinite(raw) &&
      raw >= min &&
      raw <= max
        ? raw
        : undefined,
  }
}

/** 字符串（去掉首尾空白，限制长度） */
function text(fallback: string, maxLength = 4096): ValueSpec<string> {
  return {
    kind: 'value',
    default: fallback,
    parse: raw =>
      typeof raw === 'string' && raw.length <= maxLength
        ? raw.trim()
        : undefined,
  }
}

/** 枚举 */
function oneOf<const T extends readonly string[]>(
  options: T,
  fallback: T[number]
): ValueSpec<T[number]> {
  return {
    kind: 'value',
    default: fallback,
    parse: raw =>
      options.includes(raw as T[number]) ? (raw as T[number]) : undefined,
  }
}

/** 密钥：单行、非空白字符，长度上限 4096 */
function secret(): SecretSpec {
  return {
    kind: 'secret',
    default: '',
    parse: raw =>
      typeof raw === 'string' && raw.length <= 4096 && !/[\r\n]/.test(raw)
        ? raw.trim()
        : undefined,
  }
}

/** TMDB 图片下载尺寸 */
const IMAGE_SIZES = ['w342', 'w780', 'original'] as const

/** 全部设置项 */
export const settingsSchema = {
  /** 界面主题 */
  'app.theme': oneOf(['dark', 'light'] as const, 'dark'),
  /** 成人模式：显示 AV / Amane 入口与成人源 */
  'app.adultMode': bool(false),

  /** 播放引擎 */
  'player.engine': oneOf(['built-in', 'mpv'] as const, 'built-in'),
  /** mpv 下的 RTX 视频超分（NVIDIA） */
  'player.rtxVsr': bool(false),
  /** 内置播放器上一次使用的倍速 */
  'player.playbackRate': num(0.25, 4, 1),

  /** TMDB 元数据语言 */
  'scrape.metadataLanguage': oneOf(
    ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR'] as const,
    'zh-CN'
  ),
  /** 刮削并发任务数 */
  'scrape.concurrency': int(1, 8, 3),
  /** 海报下载尺寸 */
  'scrape.imageSize.poster': oneOf(IMAGE_SIZES, 'original'),
  /** 背景图下载尺寸 */
  'scrape.imageSize.backdrop': oneOf(IMAGE_SIZES, 'original'),
  /** 演员头像下载尺寸 */
  'scrape.imageSize.actor': oneOf(IMAGE_SIZES, 'original'),
  /** 刮削服务 */
  'scrape.provider': oneOf(['tmdb', 'custom'] as const, 'tmdb'),
  /** TMDB Access Token。影视库仍直接读 localStorage，暂不作为密钥存放（影视合并后改 secret） */
  'scrape.tmdbToken': text(''),
  /** 自定义刮削服务名称 */
  'scrape.customName': text('', 200),
  /** 自定义刮削服务 API 地址 */
  'scrape.customBaseUrl': text('', 2048),
  /** 自定义刮削服务 API Key */
  'scrape.customApiKey': text(''),

  /**
   * @deprecated Go 后端已删除（p3d）。只为影视的 legacy-library-mirror 回写旧存储而保留，
   * 界面不再展示；影视合并后与 mirror 一起删除。
   */
  'backend.url': text('http://localhost:31471', 2048),
  /** @deprecated 同 backend.url；Amane 手机接入只用 Amane 自己的令牌，不再读它。 */
  'backend.apiKey': text(''),

  /** Amane 后台 API Token */
  'amane.token': secret(),
} as const satisfies Record<string, ValueSpec<unknown> | SecretSpec>

/** 设置项的键 */
export type SettingKey = keyof typeof settingsSchema
/** 普通设置项的键 */
export type ValueKey = {
  [K in SettingKey]: (typeof settingsSchema)[K] extends ValueSpec<unknown>
    ? K
    : never
}[SettingKey]
/** 敏感设置项的键 */
export type SecretKey = Exclude<SettingKey, ValueKey>
/** 全部普通设置项的值 */
export type SettingValues = {
  [K in ValueKey]: (typeof settingsSchema)[K]['default']
}
/** 某个普通设置项的值类型 */
export type SettingValue<K extends ValueKey> = SettingValues[K]

/** 渲染层启动时拿到的快照：普通值 + 密钥是否已配置 + 旧 localStorage 是否已迁移 */
export interface SettingsSnapshot {
  values: SettingValues
  secrets: Record<SecretKey, boolean>
  legacyMigrated: boolean
}

/** 一次设置变更 */
export type SettingChange = {
  [K in ValueKey]: { key: K; value: SettingValue<K> }
}[ValueKey]

/** 全部普通设置项的键 */
const valueKeys = (Object.keys(settingsSchema) as SettingKey[]).filter(
  (key): key is ValueKey => settingsSchema[key].kind === 'value'
)

/** 全部敏感设置项的键 */
export const secretKeys = (Object.keys(settingsSchema) as SettingKey[]).filter(
  (key): key is SecretKey => settingsSchema[key].kind === 'secret'
)

/** 全部普通设置项的默认值 */
export function defaultValues(): SettingValues {
  return Object.fromEntries(
    valueKeys.map(key => [key, settingsSchema[key].default])
  ) as SettingValues
}

/**
 * 解析一个普通设置项的值：键不存在或值不合法时返回 undefined。
 * 主进程写入、读取 settings.json、迁移旧值时都经过这里。
 */
export function parseSetting(
  key: string,
  raw: unknown
): SettingChange | undefined {
  if (!(key in settingsSchema)) return undefined
  const spec = settingsSchema[key as SettingKey]
  if (spec.kind !== 'value') return undefined
  const value = spec.parse(raw)
  return value === undefined ? undefined : ({ key, value } as SettingChange)
}
