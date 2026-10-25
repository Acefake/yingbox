/**
 * 媒体库 IPC 契约 · 按画面搜：用一句话（如「高跟鞋」）搜封面和剧照的画面内容。
 *
 * 模型（中文 CLIP）在本机运行，图片不上传；第一次使用要下载模型并给已识别的番号建索引。
 * 打开「视频画面」后，后台再从本地视频抽帧建索引，结果能定位到时间点。
 * 只有类型，由 contract.ts 统一再导出。
 */
import type { JobAccepted } from './contract'

/** 按画面搜的状态（设置页 / 搜索面板轮询）。 */
export interface VisualStatus {
  /** 推理组件（onnxruntime）能否加载；不能时整个功能不可用。 */
  runtime: boolean
  /** 模型文件：未下载 / 下载中 / 就绪。 */
  model: 'missing' | 'downloading' | 'ready'
  /** 索引任务在跑（含下载模型）。 */
  indexing: boolean
  /** 当前阶段进度 0–1；没在跑为 null。 */
  progress: number | null
  /** 已索引 / 可索引的番号条目数。 */
  indexed: number
  total: number
  /** 上次索引失败的原因；没有为 null。 */
  error: string | null
  /** 视频关键帧索引。 */
  frames: VisualFramesStatus
}

/** 视频关键帧的设置（引擎 settings 表，键 visual.frames）。 */
export interface VisualFramesSettings {
  /** 从本地视频抽帧建索引；默认关。 */
  enabled: boolean
  /** 暂停：正在跑的停在当前这批，进度保留。 */
  paused: boolean
  /** 网盘上的库也抽帧（要读整部视频的若干位置，默认跳过）。 */
  includeCloud: boolean
}

/** 视频关键帧索引的状态。 */
export interface VisualFramesStatus extends VisualFramesSettings {
  /** 抽帧任务在跑。 */
  running: boolean
  /** 本轮进度 0–1；没在跑为 null。 */
  progress: number | null
  /** 已抽完 / 可抽的视频文件数（按当前设置，不含网盘时不算网盘上的）。 */
  indexed: number
  total: number
  /** 已入库的帧数（去掉相近帧之后）。 */
  frames: number
  /** 上次抽帧失败的原因（如没有 ffmpeg）；没有为 null。 */
  error: string | null
}

/** 一个画面在视频里的位置。 */
export interface VisualMoment {
  fileId: number
  /** 秒。 */
  at: number
  /** 帧缩略图（yingbox-media://image/<key>）。 */
  image: string
  score: number
}

/** CLIP 召回范围：图片（封面 / 剧照）、视频关键帧或全部。 */
export type VisualSearchSource = 'all' | 'image' | 'video'

/** 搜索请求。 */
export interface VisualSearchRequest {
  /** 默认 all；在相似度排序和截取 limit 之前过滤。 */
  source?: VisualSearchSource
  /** 画面描述，如「高跟鞋」「黑丝 办公室」。 */
  text: string
  /** 只搜某个媒体库；缺省全部番号库。 */
  libraryId?: number
  /** 最多返回几部，默认 60。 */
  limit?: number
}

/** 一条结果：一部片和它最贴近描述的那张图。 */
export interface VisualHit {
  itemId: number
  title: string
  /** 余弦相似度，越大越像；只用于排序与相对比较。 */
  score: number
  /** 最匹配的图片（封面或剧照的远程地址；是视频帧时为帧缩略图）。 */
  image: string
  /** 最匹配的是视频帧：它在哪个文件的第几秒。 */
  frame?: { fileId: number; at: number }
  /** 这部片里最像的几个视频画面（按相似度降序，最多 3 个）；没抽过帧时缺省。 */
  moments?: VisualMoment[]
}

/** 按画面搜的方法。 */
export interface VisualRpcMap {
  'visual.status': { params: void; result: VisualStatus }
  /** 下载模型（缺的话）并给没索引的条目建索引。 */
  'visual.index': { params: void; result: JobAccepted }
  'visual.search': { params: VisualSearchRequest; result: VisualHit[] }
  /** 改视频关键帧设置（只改给出的项），返回新状态。 */
  'visual.setFrames': {
    params: Partial<VisualFramesSettings>
    result: VisualStatus
  }
}

/** 方法名白名单（并入 LIBRARY_METHODS）。 */
export const VISUAL_METHODS = [
  'visual.status',
  'visual.index',
  'visual.search',
  'visual.setFrames',
] as const satisfies readonly (keyof VisualRpcMap)[]

/** window.api.library 上的按画面搜方法。 */
export interface LibraryVisualBridge {
  visual: {
    status(): Promise<VisualStatus>
    index(): Promise<JobAccepted>
    search(request: VisualSearchRequest): Promise<VisualHit[]>
    setFrames(settings: Partial<VisualFramesSettings>): Promise<VisualStatus>
  }
}
