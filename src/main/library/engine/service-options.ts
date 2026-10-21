/**
 * LibraryService 的构造参数。单独成文件：宿主（platform.ts）与测试只需要类型，不必读服务实现。
 */
import type { IdentifyModuleOptions } from '../identify/identify-module'
import type { MoveOps } from '../writer/fs/file-ops'
import type { WatchMode } from './library-monitor'

/** 服务参数。 */
export interface LibraryServiceOptions {
  /** 数据库文件路径；测试可用 ':memory:'。 */
  dbPath: string
  /** 是否监控媒体库目录，默认 true；false 等同 watchMode: 'off'。 */
  watch?: boolean
  /** 监控模式，默认 auto，见 LibraryMonitor。 */
  watchMode?: WatchMode
  /** 定时增量扫描间隔，默认 0（关闭；宿主经 createLibraryService 打开）。 */
  scanIntervalMs?: number
  /** 写入稳定判定时间，默认 0（不判定；宿主经 createLibraryService 打开），见 SettleTracker。 */
  settleMs?: number
  /** 监听去抖静默时间，默认 1000 ms。 */
  watchQuietMs?: number
  /** 同时运行的任务数，默认 2。 */
  concurrency?: number
  /** 指纹实现（文件路径 → hash），测试注入。 */
  fingerprint?: (path: string) => Promise<string | undefined>
  /** 写日志（告警、监听失败）。 */
  log?: (message: string) => void
  /** 识别与刮削的注入项（网络、图片缓存目录、令牌兜底、限速），见 IdentifyModuleOptions。 */
  identify?: Pick<
    IdentifyModuleOptions,
    | 'fetch'
    | 'mediaDir'
    | 'onImagesCached'
    | 'deriveImage'
    | 'probeDuration'
    | 'env'
    | 'http'
    | 'concurrency'
  >
  /** 写出层的注入项（测试模拟跨盘）。 */
  writer?: {
    moveOps?: MoveOps
    deviceOf?: (path: string) => Promise<number | undefined>
  }
}
