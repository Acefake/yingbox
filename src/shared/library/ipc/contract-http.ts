/**
 * 媒体库 IPC 契约 · 独立服务的 HTTP 线格式（src/server 实现，网页端 transport 调用）。
 *
 * 方法、参数、结果与桌面端 IPC 完全相同：POST rpc 的请求体是 { method, params }，
 * 响应体就是 InvokeResult（错误以数据返回，带 code）。事件经 SSE 推送，每条 data 是一个 LibraryEvent。
 * 图片与视频走 /media/...，<img> / <video> 靠登录后的 HttpOnly Cookie 鉴权。
 *
 * 只有类型和常量，由 contract.ts 统一再导出。
 */

/** 路径（相对服务根）。 */
export const LIBRARY_HTTP = {
  /** GET → ServerHealth（公开） */
  health: '/api/health',
  /** POST { token } 登录（写 Cookie）；DELETE 退出（公开） */
  session: '/api/session',
  /** GET → ServerInfo */
  info: '/api/info',
  /** POST { method, params } → InvokeResult */
  rpc: '/api/library/rpc',
  /** GET → text/event-stream，每条 data 是一个 LibraryEvent */
  events: '/api/library/events',
  /** GET ?path= → DirectoryListing（不带 path 列出根目录） */
  dirs: '/api/fs/dirs',
  /** GET /media/image/<key>[?w=] → 媒体库缓存图片（对应 yingbox-media://image/） */
  image: '/media/image/',
  /** GET /media/thumb?w=&src= → 远程图片的缩略图（服务代取，带防盗链 Referer） */
  thumb: '/media/thumb',
  /** GET /media/files/<fileId> → 视频文件（支持 Range） */
  file: '/media/files/',
  /** POST { urls } → { focus: Array<MediaFocus | null> }：海报取景的焦点（urls 是上面两种图片地址） */
  focus: '/media/focus',
  /** POST { url, focus } → 204：写回人脸检测的焦点 */
  focusSave: '/media/focus/save',
  /** GET /media/subtitles/<fileId> → SubtitleListing；GET /media/subtitles/<fileId>/<文件名> → text/vtt */
  subtitles: '/media/subtitles/',
} as const

/** 视频旁的一条外挂字幕（服务端只给文件名，不给路径）。 */
export interface ServerSubtitle {
  /** 展示名（文件名去掉扩展名，含语言后缀）。 */
  name: string
  /** 小写扩展名，如 .srt。 */
  ext: string
  /** 转成 WebVTT 后的地址（/media/subtitles/<fileId>/<文件名>）。 */
  url: string
}

/** 一个视频的外挂字幕，按默认挂载的优先级排好（同名优先）。 */
export interface SubtitleListing {
  subtitles: ServerSubtitle[]
}

/** 健康检查。 */
export interface ServerHealth {
  ok: true
  /** 当前请求是否已登录。 */
  authorized: boolean
}

/** 服务信息（登录后）。 */
export interface ServerInfo {
  /** 可浏览 / 添加为媒体库的根目录。 */
  mediaRoots: string[]
  /** 出网实现的描述。 */
  fetch: string
}

/** 目录浏览结果。 */
export interface DirectoryListing {
  /** 当前目录；null 表示列的是根目录集合。 */
  path: string | null
  /** 上一级；已在根目录或列的是根目录集合时为 null。 */
  parent: string | null
  dirs: Array<{ name: string; path: string }>
}
