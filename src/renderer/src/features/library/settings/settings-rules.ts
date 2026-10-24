/**
 * 媒体库设置的纯规则与选项：文件夹描述、令牌状态文字、模板变量、整理批次标题 / 描述 / 可撤销。
 * 不依赖 Vue，便于单测。
 */
import type {
  LibraryAutoWrite,
  LibraryInfo,
  LibraryKind,
  LibraryStorage,
  OrganizeBatchInfo,
  WriterSettings,
} from '../../../../../shared/library/ipc'
import { TEMPLATE_VARIABLES } from '../../../../../shared/library/writer'
import { parseRemotePath } from '../../../../../shared/webdav/remote-path'

/** 设置里的日期时间格式。 */
export const dateFormat = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** 文件夹行的描述：（番号 · ）路径 · 上次扫描时间（没扫过时「尚未扫描」）。 */
export function folderDescription(
  lib: Pick<LibraryInfo, 'root' | 'lastScanAt'> &
    Partial<Pick<LibraryInfo, 'source'>>,
  format: (time: number) => string = t => dateFormat.format(t)
): string {
  const scanned = lib.lastScanAt
    ? `上次扫描 ${format(lib.lastScanAt)}`
    : '尚未扫描'
  const prefix = lib.source === 'jav' ? '番号 · ' : ''
  // 远程库（WebDAV）只显示源里的路径，并标明只读
  const remote = parseRemotePath(lib.root)
  const where = remote ? `WebDAV · 只读 · ${remote.path}` : lib.root
  return `${prefix}${where} · ${scanned}`
}

/** TMDB 令牌状态文字。 */
export function tokenStatus(available: boolean, configured: boolean): string {
  if (!available) return '仅桌面版可用'
  return configured ? '已配置' : '尚未配置，无法识别'
}

/** 已有 NFO 的处理方式。 */
export const NFO_MODE_OPTIONS: Array<{
  value: WriterSettings['nfo']['mode']
  label: string
}> = [
  { value: 'merge', label: '合并' },
  { value: 'overwrite', label: '覆盖' },
]

/** 图片开关行（顺序即界面顺序）。 */
export const ARTWORK_ROWS: Array<{
  key: keyof WriterSettings['artwork']
  title: string
}> = [
  { key: 'poster', title: '海报' },
  { key: 'fanart', title: '背景图' },
  { key: 'logo', title: '标志' },
  { key: 'seasonArt', title: '季海报与剧集缩略图' },
  { key: 'actors', title: '演员头像' },
  { key: 'legacyNames', title: '兼容旧播放器的文件名' },
]

/** 自动写出的选项：跟随写出设置里的「识别后自动写出」，或这个文件夹单独开 / 关。 */
export const AUTO_WRITE_OPTIONS: Array<{
  value: LibraryAutoWrite
  label: string
}> = [
  { value: 'inherit', label: '跟随全局' },
  { value: 'on', label: '开' },
  { value: 'off', label: '关' },
]

/** 「自动识别」行的描述：番号库按番号刮削，其他按片名匹配 TMDB。 */
export function autoIdentifyDescription(
  lib: Pick<LibraryInfo, 'source'>
): string {
  return lib.source === 'jav'
    ? '新文件入库后按番号刮削'
    : '新文件入库后自动匹配 TMDB（需要令牌）'
}

/** 电影模板用不到剧集变量，剧集模板全部可用。 */
const TV_ONLY = new Set(['series', 'season', 'episode', 'episodeTitle'])

/** 模板可用变量的提示文字：`{title} {year} …`。 */
export function templateVariablesFor(kind: LibraryKind): string {
  return TEMPLATE_VARIABLES.filter(v => kind === 'tv' || !TV_ONLY.has(v))
    .map(v => `{${v}}`)
    .join(' ')
}

/** 当前类型用的路径模板。 */
export function templateOf(
  settings: WriterSettings,
  kind: LibraryKind
): string {
  return kind === 'movie'
    ? settings.organize.movieTemplate
    : settings.organize.tvTemplate
}

/** 批次状态文字。 */
export const BATCH_STATE: Record<OrganizeBatchInfo['state'], string> = {
  running: '进行中',
  done: '已完成',
  partial: '部分完成',
  failed: '失败',
  undoing: '撤销中',
  undone: '已撤销',
}

/** 设置里最多列出几个最近的整理批次。 */
export const RECENT_BATCHES = 5

/** 批次标题：时间 · 状态。 */
export function batchTitle(
  batch: Pick<OrganizeBatchInfo, 'createdAt' | 'state'>,
  format: (time: number) => string = t => dateFormat.format(t)
): string {
  return `${format(batch.createdAt)} · ${BATCH_STATE[batch.state]}`
}

/** 批次描述：移动 x / y 个文件（，n 个失败）。 */
export function batchDescription(
  batch: Pick<OrganizeBatchInfo, 'moved' | 'total' | 'failed'>
): string {
  const failed = batch.failed ? `，${batch.failed} 个失败` : ''
  return `移动 ${batch.moved} / ${batch.total} 个文件${failed}`
}

/** 设置里给「撤销」按钮的批次：已完成或部分完成。 */
export const showUndo = (state: OrganizeBatchInfo['state']): boolean =>
  state === 'done' || state === 'partial'

/** 存储选项（文件夹在本地盘还是网盘 / 挂载盘）。 */
export const STORAGE_OPTIONS: Array<{ value: LibraryStorage; label: string }> =
  [
    { value: 'auto', label: '自动' },
    { value: 'local', label: '本地盘' },
    { value: 'cloud', label: '网盘' },
  ]

/** 网盘模式的说明。 */
const CLOUD_TEXT = '不定时扫描、不读视频内容，靠变更通知或手动扫描入库'

/** 存储行的描述：用户选的模式，auto 时带上判定结果。 */
export function storageDescription(
  lib: Pick<LibraryInfo, 'automation' | 'cloud'>
): string {
  const { storage } = lib.automation
  if (storage === 'cloud') return CLOUD_TEXT
  if (storage === 'local') return '监控文件变化，网络盘定时检查兜底'
  if (lib.cloud === undefined) return '按文件夹所在的磁盘自动判断'
  return lib.cloud
    ? `判断为网盘：${CLOUD_TEXT}`
    : '判断为本地盘；CloudDrive2 等挂载的盘符请选「网盘」'
}
