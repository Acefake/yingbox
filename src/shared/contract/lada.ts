import type {
  LadaJob,
  LadaLiveStatus,
  LadaPaths,
  LadaRangeReady,
  LadaResumeProgress,
} from '../lada'
import { call, defineDomain, event, num, record, str } from './define'

/** 另一个影盒实例持有的任务锁 */
export interface LadaOtherJob {
  pid: number
  input?: string
  startedAt?: number
}

const filePath = (a: readonly unknown[]): [filePath: string] => [
  str(a[0], 'filePath'),
]

/** 去马赛克（外部工具 lada-cli）：整片、续跑、区间、边跑边看。 */
export const lada = defineDomain(
  'lada',
  {
    /** 探测 lada-cli 与 ffmpeg 路径 */
    paths: call<LadaPaths>(),
    /** 覆盖路径（空串 = 恢复自动探测） */
    setPaths: call<[changes: { cli?: string; ffmpeg?: string }], LadaPaths>(
      a => [record<{ cli?: string; ffmpeg?: string }>(a[0], 'changes')]
    ),
    /** 对某个视频发起整片去码 */
    start: call<
      [filePath: string],
      { success: boolean; job?: LadaJob; error?: string }
    >(filePath),
    /** 取消当前任务 */
    cancel: call<{ success: boolean }>(),
    /** 当前任务快照 */
    status: call<LadaJob | null>(),
    /** 别的影盒实例是否在跑任务（跨实例可见） */
    otherJob: call<LadaOtherJob | null>(),
    /** 播放时优先返回已修复的产物 */
    playablePath: call<[filePath: string], { path: string; restored: boolean }>(
      filePath
    ),
    /** 边跑边看：起 lada + 追播，返回可交给播放器的 m3u8 地址 */
    startLive: call<
      [filePath: string],
      { success: boolean; url?: string; error?: string }
    >(filePath),
    /** 停止边跑边看 */
    stopLive: call<{ success: boolean }>(),
    /** 边跑边看的当前状态 */
    liveStatus: call<LadaLiveStatus | null>(),
    /** 查询该片已处理的进度（暂停 / 继续） */
    resumeInfo: call<[filePath: string], LadaResumeProgress | null>(filePath),
    /** 继续处理：裁剩余 → 跑剩余 → 拼接补音轨 */
    resume: call<
      [filePath: string],
      { success: boolean; error?: string; doneSeconds?: number }
    >(filePath),
    /** 接管 lada 写在临时目录里的半成品 */
    adoptPartial: call<
      [filePath: string, partialPath: string],
      LadaResumeProgress | null
    >(a => [str(a[0], 'filePath'), str(a[1], 'partialPath')]),
    /** 清理可再生的缓存（保留暂停任务的进度） */
    clearCache: call<{ success: boolean; freed?: number }>(),
    /** 缓存目录总字节数 */
    cacheSize: call<number>(),
    /** 区间去码：只处理 [起点, 终点]，终点 <= 0 表示到片尾 */
    startRange: call<
      [filePath: string, startSeconds: number, endSeconds: number],
      {
        success: boolean
        error?: string
        output?: string
        start?: number
        end?: number
      }
    >(a => [
      str(a[0], 'filePath'),
      num(a[1], 'startSeconds'),
      num(a[2], 'endSeconds'),
    ]),
  },
  {
    /** 整片任务进度 */
    progress: event<LadaJob | null>(),
    /** 整片任务结束（成功 / 失败 / 取消） */
    finished: event<LadaJob | null>(),
    /** 边跑边看状态 */
    live: event<LadaLiveStatus | null>(),
    /** 区间产物拼好（成功给 path，失败给 error） */
    rangeReady: event<LadaRangeReady>(),
    /** 给用户看的一次性提示 */
    notice: event<string>(),
  }
)
