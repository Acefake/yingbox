/**
 * Anime4K 超分（mpv 着色器）的纯规则：模式 → 着色器列表、着色器来源与校验值、配置校验、动画条目判断。
 * 主进程（下载与挂载，src/main/mpv-anime4k.ts）与渲染层（设置、开播时判断条目类型）共用。
 *
 * 着色器来自 Anime4K 官方仓库 v4.0.1（bloc97/Anime4K，MIT 许可），首次使用时按需下载到
 * userData/anime4k/v4.0.1/，不随仓库提交、不随安装包分发。每个文件按 SHA-256 校验。
 * 模式与组合照搬官方 mpv 模板（md/Template/GLSL_Windows_High-end|Low-end/input.conf）：
 *   A：Restore → Upscale → Upscale（大多数 1080p 动画、模糊较多的老片）
 *   B：Restore_Soft → Upscale → Upscale（多数 720p、由 1080p 缩下来的片源）
 *   C：Upscale_Denoise → Upscale（几乎无损的高质量片源）
 * 画质档（hq）用 VL 网络，性能档（fast）用 M 网络。
 */

/** 官方版本（下载目录与地址都按它区分）。 */
export const ANIME4K_VERSION = 'v4.0.1'

/** 模式。 */
export const ANIME4K_MODES = ['a', 'b', 'c'] as const
export type Anime4kMode = (typeof ANIME4K_MODES)[number]

/** 档位：画质 / 性能。 */
export const ANIME4K_QUALITIES = ['hq', 'fast'] as const
export type Anime4kQuality = (typeof ANIME4K_QUALITIES)[number]

/** 渲染层同步给主进程的配置（来自设置 → 播放器）。 */
export interface Anime4kConfig {
  enabled: boolean
  mode: Anime4kMode
  quality: Anime4kQuality
  /** 只对动画类条目启用 */
  animeOnly: boolean
}

/** 关闭状态的配置（主进程初始值）。 */
export const ANIME4K_OFF: Anime4kConfig = {
  enabled: false,
  mode: 'a',
  quality: 'fast',
  animeOnly: false,
}

/** 着色器文件名 → 仓库内路径（glsl/ 下）与 SHA-256（v4.0.1，LF 换行的仓库原文件）。 */
export const ANIME4K_FILES = {
  'Anime4K_Clamp_Highlights.glsl': {
    path: 'Restore/Anime4K_Clamp_Highlights.glsl',
    sha256: 'a2a9bf7fbc1d75d09660ca2e701e4d7fb0cf5457b94da47e1825032fa2b3671a',
  },
  'Anime4K_Restore_CNN_VL.glsl': {
    path: 'Restore/Anime4K_Restore_CNN_VL.glsl',
    sha256: '35036722733305cd4d4e57660b883bbe2569ba2914033c254327107d7b77e35e',
  },
  'Anime4K_Restore_CNN_Soft_VL.glsl': {
    path: 'Restore/Anime4K_Restore_CNN_Soft_VL.glsl',
    sha256: '094334b0e20c1a201fe4941c7c68de72451e5aee9efb5524d7fb82b12dca64b9',
  },
  'Anime4K_Restore_CNN_M.glsl': {
    path: 'Restore/Anime4K_Restore_CNN_M.glsl',
    sha256: '67ea3ed26539e8de3b7d307688535d2ff17e8d147e11dda0247da7770dbecf41',
  },
  'Anime4K_Restore_CNN_Soft_M.glsl': {
    path: 'Restore/Anime4K_Restore_CNN_Soft_M.glsl',
    sha256: 'a78a2c76898e08e09e442a9628c64208c26e8e15789649b8755223f009794c02',
  },
  'Anime4K_Upscale_CNN_x2_VL.glsl': {
    path: 'Upscale/Anime4K_Upscale_CNN_x2_VL.glsl',
    sha256: '5638fe31c37c151a3443fea3451a3ef91af073f4dbb9615f6c0d1e29db11493d',
  },
  'Anime4K_Upscale_CNN_x2_M.glsl': {
    path: 'Upscale/Anime4K_Upscale_CNN_x2_M.glsl',
    sha256: '716e02098a68f0d648761f2b96b4dd139e1cb09b174bb369fca3aa34328fff7e',
  },
  'Anime4K_Upscale_CNN_x2_S.glsl': {
    path: 'Upscale/Anime4K_Upscale_CNN_x2_S.glsl',
    sha256: '4c53ec2e287908f7ee7bcb266b0170421626d663576468b7d7dafc62962649a4',
  },
  'Anime4K_AutoDownscalePre_x2.glsl': {
    path: 'Upscale/Anime4K_AutoDownscalePre_x2.glsl',
    sha256: '8c58291740146bd766a4d73f132775a797fe80f7d07919b5d767e27a5dc85656',
  },
  'Anime4K_AutoDownscalePre_x4.glsl': {
    path: 'Upscale/Anime4K_AutoDownscalePre_x4.glsl',
    sha256: '5af62d8cd844916dc1126613e13bad3beab195787f93a71200b47c6ec78f2e41',
  },
  'Anime4K_Upscale_Denoise_CNN_x2_VL.glsl': {
    path: 'Upscale+Denoise/Anime4K_Upscale_Denoise_CNN_x2_VL.glsl',
    sha256: '359c48fe5a317fbc6b706ce368401eef496e84ed98abac7a43efebca2b65d79b',
  },
  'Anime4K_Upscale_Denoise_CNN_x2_M.glsl': {
    path: 'Upscale+Denoise/Anime4K_Upscale_Denoise_CNN_x2_M.glsl',
    sha256: '8c72b042e2301fe66a45c3089720459148e2504cd72af16f9c0d5017ff14181e',
  },
} as const satisfies Record<string, { path: string; sha256: string }>

/** 着色器文件名。 */
export type Anime4kFile = keyof typeof ANIME4K_FILES

/** 随着色器一起下载保存的许可证（MIT 要求保留版权声明）。 */
export const ANIME4K_LICENSE = {
  path: 'LICENSE',
  sha256: '5bad448b737378e3d0c977ad0d0521fa37ad279a7e76ea9a31d9257eeb6953f5',
} as const

/**
 * 某个仓库文件的下载地址，按顺序尝试：GitHub 原始文件 → jsDelivr 镜像（国内通常更快）。
 * @param repoPath 仓库根下的路径（如 glsl/Restore/xxx.glsl、LICENSE）
 */
export function anime4kSourceUrls(repoPath: string): string[] {
  const encoded = repoPath.split('/').map(encodeURIComponent).join('/')
  return [
    `https://raw.githubusercontent.com/bloc97/Anime4K/${ANIME4K_VERSION}/${encoded}`,
    `https://cdn.jsdelivr.net/gh/bloc97/Anime4K@${ANIME4K_VERSION}/${encoded}`,
  ]
}

/** 模式 + 档位 → 按顺序挂载的着色器（官方模板的组合）。 */
export function anime4kShaders(
  mode: Anime4kMode,
  quality: Anime4kQuality
): Anime4kFile[] {
  const big = quality === 'hq' ? 'VL' : 'M'
  const small = quality === 'hq' ? 'M' : 'S'
  const first: Record<Anime4kMode, Anime4kFile[]> = {
    a: [
      `Anime4K_Restore_CNN_${big}.glsl`,
      `Anime4K_Upscale_CNN_x2_${big}.glsl`,
    ],
    b: [
      `Anime4K_Restore_CNN_Soft_${big}.glsl`,
      `Anime4K_Upscale_CNN_x2_${big}.glsl`,
    ],
    c: [`Anime4K_Upscale_Denoise_CNN_x2_${big}.glsl`],
  }
  return [
    'Anime4K_Clamp_Highlights.glsl',
    ...first[mode],
    'Anime4K_AutoDownscalePre_x2.glsl',
    'Anime4K_AutoDownscalePre_x4.glsl',
    `Anime4K_Upscale_CNN_x2_${small}.glsl`,
  ]
}

/** 这次播放要不要挂 Anime4K：开关打开，且（不限条目，或条目是动画）。 */
export function shouldApplyAnime4k(
  config: Anime4kConfig,
  anime: boolean | undefined
): boolean {
  return config.enabled && (!config.animeOnly || anime === true)
}

/** 动画类型的类型名 / 标签（TMDB 中文「动画」、英文 Animation，CMS 站的「动漫」「番剧」等）。 */
const ANIME_RE = /动画|动漫|番剧|新番|アニメ|anime|animation|cartoon/i

/**
 * 条目是不是动画：媒体库看 TMDB 类型（genres），在线看站点分类（type_name）。
 * 都拿不到时返回 false（「仅动画类条目」模式下不启用）。
 */
export function isAnimeEntry(entry: {
  genres?: readonly string[]
  typeName?: string
}): boolean {
  if (entry.genres?.some(genre => ANIME_RE.test(genre))) return true
  return Boolean(entry.typeName && ANIME_RE.test(entry.typeName))
}

/** 校验渲染层传来的配置；不合法抛错。 */
export function parseAnime4kConfig(value: unknown): Anime4kConfig {
  if (!value || typeof value !== 'object') throw new Error('配置应为对象')
  const v = value as Record<string, unknown>
  if (typeof v['enabled'] !== 'boolean') throw new Error('enabled 应为布尔值')
  if (typeof v['animeOnly'] !== 'boolean')
    throw new Error('animeOnly 应为布尔值')
  if (!(ANIME4K_MODES as readonly unknown[]).includes(v['mode']))
    throw new Error('mode 不合法')
  if (!(ANIME4K_QUALITIES as readonly unknown[]).includes(v['quality']))
    throw new Error('quality 不合法')
  return {
    enabled: v['enabled'],
    mode: v['mode'] as Anime4kMode,
    quality: v['quality'] as Anime4kQuality,
    animeOnly: v['animeOnly'],
  }
}

/** 给人看的模式名（mpv 窗口提示用）。 */
export function anime4kLabel(
  mode: Anime4kMode,
  quality: Anime4kQuality
): string {
  return `Anime4K：模式 ${mode.toUpperCase()}（${quality === 'hq' ? '画质' : '性能'}）`
}
