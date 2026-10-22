/**
 * 媒体库 IPC 契约 · 按画面搜：用一句话（如「高跟鞋」）搜封面和剧照的画面内容。
 *
 * 模型（中文 CLIP）在本机运行，图片不上传；第一次使用要下载模型并给已识别的番号建索引。
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
}

/** 搜索请求。 */
export interface VisualSearchRequest {
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
  /** 最匹配的图片（封面或剧照的远程地址）。 */
  image: string
}

/** 按画面搜的方法。 */
export interface VisualRpcMap {
  'visual.status': { params: void; result: VisualStatus }
  /** 下载模型（缺的话）并给没索引的条目建索引。 */
  'visual.index': { params: void; result: JobAccepted }
  'visual.search': { params: VisualSearchRequest; result: VisualHit[] }
}

/** 方法名白名单（并入 LIBRARY_METHODS）。 */
export const VISUAL_METHODS = [
  'visual.status',
  'visual.index',
  'visual.search',
] as const satisfies readonly (keyof VisualRpcMap)[]

/** window.api.library 上的按画面搜方法。 */
export interface LibraryVisualBridge {
  visual: {
    status(): Promise<VisualStatus>
    index(): Promise<JobAccepted>
    search(request: VisualSearchRequest): Promise<VisualHit[]>
  }
}
