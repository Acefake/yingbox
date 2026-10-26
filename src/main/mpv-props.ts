/**
 * mpv 状态的初始值、要观察的属性、track-list / playlist 原始数据到共享类型的整理，
 * 以及新进程的命令行参数（{@link spawnArgs}）与换片前要设的属性（{@link replaceProps}）。
 */
import { type MpvHeaders, headerArgs } from './mpv-stream'
import type { MpvPlaylistEntry, MpvStatus, MpvTrack } from '../shared/mpv'

/** 播放器没在运行时的状态 */
export const DEFAULT_STATUS: MpvStatus = {
  running: false,
  paused: true,
  volume: 100,
  muted: false,
  speed: 1,
  tracks: [],
  playlist: [],
  playlistPos: 0,
}

/** 需要持续观察的 mpv 属性（按索引注册，从 1 开始） */
export const WATCH_PROPS = [
  'time-pos',
  'duration',
  'pause',
  'volume',
  'mute',
  'speed',
  'track-list',
  'media-title',
  'path',
  'playlist',
  'playlist-pos',
  'video-params',
]

/** mpv 窗口里切换「缩小置顶」的快捷键（运行时用 keybind 绑定，发 script-message 给影盒） */
export const COMPACT_KEY = 'Alt+p'
/** 快捷键发来的 client-message 名 */
export const COMPACT_MESSAGE = 'yingbox-compact'

/**
 * 「缩小置顶」要设的 mpv 属性（按顺序）。
 * 开：置顶 + 480×270 贴屏幕右下角（留 24 像素）；关：取消置顶 + 回到首次打开时的 1600×900 并居中。
 */
export function compactProps(on: boolean): Array<[string, unknown]> {
  return on
    ? [
        ['ontop', true],
        ['geometry', '480x270-24-24'],
      ]
    : [
        ['ontop', false],
        ['geometry', '1600x900+50%+50%'],
      ]
}

/** mpv 的 track-list → 音轨 / 字幕轨列表 */
export function parseTracks(raw: Record<string, unknown>[]): MpvTrack[] {
  if (!Array.isArray(raw)) return []
  return raw.map(t => ({
    id: t.id as number,
    type: t.type as MpvTrack['type'],
    title: t.title as string | undefined,
    lang: t.lang as string | undefined,
    selected: Boolean(t.selected),
    codec: t.codec as string | undefined,
    forced: Boolean(t.forced),
    default: Boolean(t.default),
    externalFilename: t['external-filename'] as string | undefined,
  }))
}

/** mpv 的 playlist → 播放列表条目 */
export function parsePlaylist(
  raw: Record<string, unknown>[]
): MpvPlaylistEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.map(p => ({
    url: p.filename as string | undefined,
    name: p.title as string | undefined,
  }))
}

/** 新开 mpv 进程的参数来源 */
export interface SpawnArgsInput {
  socket: string
  target: string
  startAt?: number
  title?: string
  subFile?: string
  /** 请求头选项（mpv-stream） */
  headers: MpvHeaders
  /** RTX 视频超分：要走 D3D11 */
  vsr: boolean
}

/** 新开 mpv 进程的命令行参数（目标地址在最后） */
export function spawnArgs(input: SpawnArgsInput): string[] {
  const args = [
    `--input-ipc-server=${input.socket}`,
    '--force-window=yes',
    '--keep-open=yes',
    '--osc=yes',
    '--no-terminal',
    '--ytdl=no',
    // 无边框：不显示 Windows 标题栏及其英文系统菜单，菜单改由影盒提供。
    // --window-dragging 默认 yes，无边框时仍可用鼠标拖动窗口。
    '--border=no',
    // 首次打开（新进程）时的初始窗口尺寸；之后由用户自己调整并保持。
    '--geometry=1600x900',
  ]
  // RTX 视频超分依赖 d3d11vpp 滤镜，必须走 D3D11 的 GPU API；同时固定 D3D11 硬解，让帧停留在 GPU 上。
  if (input.vsr) args.push('--gpu-api=d3d11', '--hwdec=d3d11va')
  if (typeof input.startAt === 'number') args.push(`--start=${input.startAt}`)
  if (input.title) args.push(`--title=${input.title}`)
  if (input.subFile) args.push(`--sub-file=${input.subFile}`)
  args.push(...headerArgs(input.headers))
  args.push(input.target)
  return args
}

/**
 * 已在运行的 mpv 换片（loadfile replace）前要设的属性。位置与标题走全局选项（同新进程的 --start / --title）：
 * loadfile 只是排队，紧接着设 time-pos 时文件还没加载（property unavailable），open 会失败；
 * 没给位置时清掉上一次的 --start，没给标题时回到按片名显示。
 */
export function replaceProps(input: {
  startAt?: number
  title?: string
}): Array<[string, string]> {
  return [
    ['start', typeof input.startAt === 'number' ? `${input.startAt}` : 'none'],
    ['title', input.title || '${media-title}'],
  ]
}

/** 把一条 property-change 写进状态（video-params 由播放器自己处理超分，不在这里） */
export function patchStatus(
  status: MpvStatus,
  name: string,
  data: unknown
): void {
  const num = (fallback?: number): number | undefined =>
    typeof data === 'number' ? data : fallback
  const str = (): string | undefined =>
    typeof data === 'string' ? data : undefined
  switch (name) {
    case 'time-pos':
      status.position = num()
      // 启动时可能在 IPC 连接前已经就绪；有效播放位置可补齐该状态。
      if (typeof data === 'number') status.loading = false
      break
    case 'duration':
      status.duration = num()
      break
    case 'pause':
      status.paused = Boolean(data)
      break
    case 'volume':
      status.volume = num(100)!
      break
    case 'mute':
      status.muted = Boolean(data)
      break
    case 'speed':
      status.speed = num(1)!
      break
    case 'media-title':
      status.title = str()
      break
    case 'path':
      status.path = str()
      break
    case 'playlist-pos':
      status.playlistPos = num(0)!
      break
    case 'track-list':
      status.tracks = parseTracks(data as Record<string, unknown>[])
      break
    case 'playlist':
      status.playlist = parsePlaylist(data as Record<string, unknown>[])
      break
  }
}
