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

/** [min, max] 内的有限数字 */
function num(min: number, max: number, fallback: number): ValueSpec<number> {
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

/** 本机绝对路径（Windows 盘符 / UNC / POSIX），空串表示用默认值 */
function absolutePath(): ValueSpec<string> {
  return {
    kind: 'value',
    default: '',
    parse: raw => {
      if (typeof raw !== 'string' || raw.length > 4096) return undefined
      const path = raw.trim()
      if (!path) return ''
      if (/[\0\r\n]/.test(path)) return undefined
      return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path) ? path : undefined
    },
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
  /** 成人模式：显示 AV / 去马赛克入口与成人源 */
  'app.adultMode': bool(false),

  /** 卡片悬停预览：悬停一会儿在卡内静音播放预告 / 片段（系统「减少动态效果」时始终不播） */
  'ui.hoverPreview': bool(true),
  /** 悬停多久开始预览（毫秒） */
  'ui.hoverPreviewDelay': num(200, 2000, 600),
  /** 应用内小窗：页内播放中离开详情时，同一个播放器移到右下角小窗继续播（网页端） */
  'ui.miniPlayer': bool(true),
  /** 媒体库视频墙同时播放几格（其余格轮播图片；渲染层只用 1 / 2 / 4 / 6 / 9） */
  'ui.videoWallMaxLive': num(1, 9, 4),

  /** 播放引擎 */
  'player.engine': oneOf(['built-in', 'mpv'] as const, 'built-in'),
  /** mpv 下的 RTX 视频超分（NVIDIA） */
  'player.rtxVsr': bool(false),
  /** mpv 下的 Anime4K 超分（着色器按需下载，见 shared/anime4k.ts） */
  'player.anime4k': bool(false),
  /** Anime4K 模式：A / B / C */
  'player.anime4kMode': oneOf(['a', 'b', 'c'] as const, 'a'),
  /** Anime4K 档位：画质（VL 网络）/ 性能（M 网络） */
  'player.anime4kQuality': oneOf(['hq', 'fast'] as const, 'fast'),
  /** Anime4K 只对动画类条目启用（媒体库看 TMDB 类型，在线看站点分类） */
  'player.anime4kAnimeOnly': bool(false),
  /** 内置播放器上一次使用的倍速 */
  'player.playbackRate': num(0.25, 4, 1),

  /** TMDB 元数据语言 */
  'scrape.metadataLanguage': oneOf(
    ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR'] as const,
    'zh-CN'
  ),
  /** 海报下载尺寸 */
  'scrape.imageSize.poster': oneOf(IMAGE_SIZES, 'original'),
  /** 背景图下载尺寸 */
  'scrape.imageSize.backdrop': oneOf(IMAGE_SIZES, 'original'),
  /** 演员头像下载尺寸 */
  'scrape.imageSize.actor': oneOf(IMAGE_SIZES, 'original'),
  /** 刮削服务 */
  'scrape.provider': oneOf(['tmdb', 'custom'] as const, 'tmdb'),
  /** TMDB Access Token（密钥：主进程 safeStorage；只在主进程与后台引擎使用，见 src/main/tmdb.ts） */
  'scrape.tmdbToken': secret(),
  /** 自定义刮削服务名称 */
  'scrape.customName': text('', 200),
  /** 自定义刮削服务 API 地址 */
  'scrape.customBaseUrl': text('', 2048),
  /** 自定义刮削服务 API Key */
  'scrape.customApiKey': text(''),

  /** 番号下载目录（绝对路径）；空串 = 系统「视频」文件夹下的「影盒下载」。经 settings.chooseDownloadDir 选择 */
  'download.dir': absolutePath(),

  /** 媒体库外部变更通知（CloudDrive2 webhook 等）：主进程本地 HTTP 端点，见 src/main/library/notify */
  'library.notify.enabled': bool(false),
  /** 允许局域网访问（监听 0.0.0.0）；关闭时只监听 127.0.0.1 */
  'library.notify.lan': bool(false),
  /** 端口；被占用时主进程换一个空闲端口并写回 */
  'library.notify.port': num(1024, 65535, 47291),
  /** 鉴权令牌（随机生成，填在通知地址里）；空串表示还没生成 */
  'library.notify.token': text('', 128),
  /** 网盘工具的根在本机的挂载目录（如 D:\CloudDrive）；可选，帮助把通知路径对应到库目录 */
  'library.notify.mountRoot': absolutePath(),
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
