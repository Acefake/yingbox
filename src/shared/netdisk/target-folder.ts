/**
 * 115 转存目标文件夹的解析规则（纯函数，主进程、片库服务与渲染层共用）。
 *
 * 优先级：单独指定的文件夹（追更某部剧 / 网盘页手动选的）> 按内容类型的默认目录
 * （设置 `pan115.movieCid` / `pan115.tvCid`）> 原有的转存目标 `pan115.targetCid`（兜底，"0" = 根目录）。
 * 类型默认目录没设时沿用原转存目标，所以只设过一个转存目标的老配置不用迁移，照旧落到原文件夹。
 * 类型未知（搜索词没对上 TMDB、磁力离线）按电影处理。
 */

/** 内容类型：决定用哪个默认目录 */
export type TargetKind = 'movie' | 'tv'

/** 一个 115 文件夹：cid + 显示名（根目录 cid 为 "0"、名字为空串） */
export interface TargetFolder {
  cid: string
  name: string
}

/** 解析要读的设置（与 shared/settings/schema.ts 的 pan115.* 同名） */
export interface TargetSettings {
  'pan115.targetCid': string
  'pan115.targetName': string
  'pan115.movieCid': string
  'pan115.movieName': string
  'pan115.tvCid': string
  'pan115.tvName': string
}

/** 解析用到的设置键 */
export const TARGET_SETTING_KEYS = [
  'pan115.targetCid',
  'pan115.targetName',
  'pan115.movieCid',
  'pan115.movieName',
  'pan115.tvCid',
  'pan115.tvName',
] as const satisfies readonly (keyof TargetSettings)[]

/** 根目录 */
export const ROOT_FOLDER: TargetFolder = { cid: '0', name: '' }

/** 合法 cid（纯数字）原样返回，其余（空串、乱填）当根目录 "0" */
export function normalizeCid(cid: string | null | undefined): string {
  return cid && /^\d{1,32}$/.test(cid) ? cid : '0'
}

/** 文件夹的规范形：cid 规范化，根目录不带名字 */
export function folderOf(cid: string, name: string): TargetFolder {
  const at = normalizeCid(cid)
  return at === '0' ? ROOT_FOLDER : { cid: at, name }
}

/** 从读设置的函数取齐解析要用的几项（主进程 host.setting / 服务端 settings.get） */
export function readTargetSettings(
  get: (key: keyof TargetSettings) => string
): TargetSettings {
  return Object.fromEntries(
    TARGET_SETTING_KEYS.map(key => [key, get(key)])
  ) as unknown as TargetSettings
}

/** 原有的转存目标（兜底） */
export function legacyFolder(settings: TargetSettings): TargetFolder {
  return folderOf(settings['pan115.targetCid'], settings['pan115.targetName'])
}

/** 这个类型有没有单独设默认目录（没设时沿用原转存目标） */
export function hasKindDefault(
  kind: TargetKind,
  settings: TargetSettings
): boolean {
  return Boolean(settings[kind === 'tv' ? 'pan115.tvCid' : 'pan115.movieCid'])
}

/** 按类型的默认目录：电影 / 剧集默认目录，没设时沿用原转存目标 */
export function defaultFolder(
  kind: TargetKind,
  settings: TargetSettings
): TargetFolder {
  const [cidKey, nameKey] =
    kind === 'tv'
      ? (['pan115.tvCid', 'pan115.tvName'] as const)
      : (['pan115.movieCid', 'pan115.movieName'] as const)
  return settings[cidKey]
    ? folderOf(settings[cidKey], settings[nameKey])
    : legacyFolder(settings)
}

/**
 * 解析转存目标：单独指定 > 类型默认目录 > 原转存目标。
 * @param override 单独指定的文件夹；null / 空 cid 表示没指定
 * @param kind 内容类型；null 表示不知道（按电影）
 */
export function resolveTarget(
  override: { cid: string; name: string } | null | undefined,
  kind: TargetKind | null,
  settings: TargetSettings
): TargetFolder {
  if (override?.cid) return folderOf(override.cid, override.name)
  return defaultFolder(kind ?? 'movie', settings)
}

/** 给人看的文件夹名：根目录为「根目录」，没名字时退回 cid */
export function folderLabel(folder: TargetFolder): string {
  if (folder.cid === '0') return '根目录'
  return folder.name || `文件夹 ${folder.cid}`
}
