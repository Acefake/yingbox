/**
 * 媒体库 IPC 契约 · 库级自动化：新文件入库后自动做到哪一步（监控 → 识别 / 刮削 → 写 NFO → 整理）。
 *
 * 库级自动化使用四个独立开关，形状与默认值是这里唯一的定义。添加 / 修改媒体库的请求也在这里。
 * 只有类型和常量，由 contract.ts 统一再导出。
 */
import type { LibraryKind } from './contract'
import type { LibrarySource } from './contract-jav'

/** 识别后自动写出 NFO 与图片：inherit 跟随写出设置里的「识别后自动写出」。 */
export type LibraryAutoWrite = 'inherit' | 'on' | 'off'

/**
 * 文件夹在哪种存储上：auto 按根目录判定（UNC 网络路径，或 Linux 上 nfs / cifs / fuse 等事件不可靠的
 * 文件系统，见 scanner/fs-type.ts，判为网盘）；local / cloud 是用户指定。
 * 网盘模式：不定时扫描、不靠文件系统事件，只按外部变更通知或手动扫描入库；不读视频内容
 * （不算指纹、不拉悬停预览视频，时长探测与 OpenSubtitles 哈希在识别时按需、限速）。
 */
export type LibraryStorage = 'auto' | 'local' | 'cloud'

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
  /** 存储：自动判定 / 本地盘 / 网盘（挂载盘）。 */
  storage: LibraryStorage
}

/** 自动化默认值：监控 + 自动识别，写出跟随全局设置，不自动整理。 */
export const DEFAULT_LIBRARY_AUTOMATION: LibraryAutomation = {
  watch: true,
  identify: true,
  write: 'inherit',
  organize: false,
  storage: 'auto',
}

/** 存储的取值。 */
export const LIBRARY_STORAGE: readonly LibraryStorage[] = [
  'auto',
  'local',
  'cloud',
]

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
  /** 同一目录同时包含电影和剧集。 */
  mixed?: boolean
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
  /** 将已有电影库或剧集库扩展为混合库。 */
  mixed?: true
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
    storage: LIBRARY_STORAGE.includes(s.storage as LibraryStorage)
      ? (s.storage as LibraryStorage)
      : d.storage,
  }
}

/** 外部文件变更通知的动作（CloudDrive2 webhook 的 action 取值）。 */
export type FileChangeAction = 'create' | 'modify' | 'delete' | 'rename'

/** 文件变更通知的动作取值。 */
export const FILE_CHANGE_ACTIONS: readonly FileChangeAction[] = [
  'create',
  'modify',
  'delete',
  'rename',
]

/** 一条外部文件变更：path 是变化项（改名时是原路径），destination 是改名 / 移动后的路径。 */
export interface FileChangeNotice {
  action: FileChangeAction
  path: string
  destination?: string
}

/**
 * 外部变更通知（主进程本地 HTTP 端点收到后转给引擎，见 src/main/library/notify）。
 * 路径可以是本机路径，也可以是网盘工具自己的路径（CloudDrive2 的 /115/电影/…）：
 * 引擎先试 mountRoot 拼接，再试直接落在库目录下，最后按「库目录末尾几段 = 通知路径开头几段」对齐。
 */
export interface NotifyChangesRequest {
  changes: FileChangeNotice[]
  /** 网盘工具的根在本机挂载到哪里（如 D:\CloudDrive）；可选。 */
  mountRoot?: string
}

/** 通知受理结果：对应到某个库的条数与对不上任何库的条数。 */
export interface NotifyChangesResult {
  accepted: number
  ignored: number
}

/** 外部变更通知的 RPC（主进程 HTTP 端点转来）：对应到库目录后去抖合并，再按目录增量扫描。 */
export interface LibraryNotifyRpcMap {
  notifyChanges: { params: NotifyChangesRequest; result: NotifyChangesResult }
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
