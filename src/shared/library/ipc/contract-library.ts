/**
 * 媒体库 IPC 契约 · 库级自动化：新文件入库后自动做到哪一步（监控 → 识别 / 刮削 → 写 NFO → 整理）。
 *
 * 行为对齐 Amane 的库设置（automation none / watch / scrape、write_nfo、auto_organize），
 * 拆成四个独立开关，形状与默认值是这里唯一的定义。添加 / 修改媒体库的请求也在这里。
 * 只有类型和常量，由 contract.ts 统一再导出。
 */
import type { LibraryKind } from './contract'
import type { LibrarySource } from './contract-jav'

/** 识别后自动写出 NFO 与图片：inherit 跟随写出设置里的「识别后自动写出」。 */
export type LibraryAutoWrite = 'inherit' | 'on' | 'off'

/** 一个媒体库的自动化设置。 */
export interface LibraryAutomation {
  /**
   * 监控文件夹：文件系统事件 + 定时增量扫描兜底，新文件写入稳定后自动入库。
   * 关闭后只在手动扫描时入库。
   */
  watch: boolean
  /** 新入库 / 文件变化的条目自动识别（番号库按番号刮削；TMDB 库需要令牌）。 */
  identify: boolean
  /** 识别后自动写出 NFO 与图片。 */
  write: LibraryAutoWrite
  /**
   * 识别后自动整理（按模板改名移动）：只整理自动匹配 / 已锁定的条目，只执行没有冲突的项，
   * 每次记一个可撤销的批次。还要求写出设置里「允许整理文件」已开启。
   */
  organize: boolean
}

/** 自动化默认值：监控 + 自动识别，写出跟随全局设置，不自动整理。 */
export const DEFAULT_LIBRARY_AUTOMATION: LibraryAutomation = {
  watch: true,
  identify: true,
  write: 'inherit',
  organize: false,
}

/** 自动写出的取值。 */
export const LIBRARY_AUTO_WRITE: readonly LibraryAutoWrite[] = [
  'inherit',
  'on',
  'off',
]

/** 添加媒体库。 */
export interface AddLibraryRequest {
  root: string
  kind: LibraryKind
  name?: string
  /** 缺省 tmdb；jav 只能用于电影库。 */
  source?: LibrarySource
  /** 缺省见 DEFAULT_LIBRARY_AUTOMATION。 */
  automation?: Partial<LibraryAutomation>
}

/** 修改媒体库：只改给出的字段。 */
export interface UpdateLibraryRequest {
  libraryId: number
  name?: string
  automation?: Partial<LibraryAutomation>
}

/** 把存储里（可能缺字段、可能是旧版本）的自动化设置与默认值合并。 */
export function withAutomationDefaults(
  saved: Partial<LibraryAutomation> | null | undefined
): LibraryAutomation {
  const d = DEFAULT_LIBRARY_AUTOMATION
  const s = saved ?? {}
  return {
    watch: typeof s.watch === 'boolean' ? s.watch : d.watch,
    identify: typeof s.identify === 'boolean' ? s.identify : d.identify,
    write: LIBRARY_AUTO_WRITE.includes(s.write as LibraryAutoWrite)
      ? (s.write as LibraryAutoWrite)
      : d.write,
    organize: typeof s.organize === 'boolean' ? s.organize : d.organize,
  }
}

/**
 * 海报墙悬停预览的数据（getPreview）。库根目录在本机可靠磁盘上时给第一个视频文件，渲染层从片中 10%
 * 处播几秒；网盘 / 网络路径（UNC，或 fs-type 判定为 nfs / cifs / fuse 等）不给视频，只轮播已缓存的图片。
 */
export interface ItemPreview {
  /** 可直接播放的视频文件；网络路径或没有视频文件时为 null */
  video: { fileId: number; path: string } | null
  /** 已缓存的图片（yingbox-media://image/<key>，背景图与季 / 集图），不含海报，最多 8 张 */
  images: string[]
}
