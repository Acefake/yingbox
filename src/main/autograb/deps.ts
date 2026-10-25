/**
 * 追更服务的依赖：日历、媒体库通知、115 / PanSou、状态读写、时钟。由 index.ts 接到真实实现，测试可全部替换。
 */
import type { NetdiskItem, ShareSnap } from '../../shared/contract/pan115'
import type {
  CalendarRequest,
  CalendarResult,
  FileChangeNotice,
} from '../../shared/library/ipc'
import type { DriveEntry, DriveSpace } from '../pan115/client'
import type { GateKind } from './gate'
import type { AutograbState, EpisodeRecord } from './state'

/** 依赖 */
export interface AutograbDeps {
  calendar(range: CalendarRequest): Promise<CalendarResult>
  notify(changes: FileChangeNotice[]): Promise<void>
  pan: {
    loggedIn(): boolean
    pansouReady(): boolean
    search(keyword: string): Promise<NetdiskItem[]>
    snap(
      url: string,
      password: string,
      dirCid: string,
      offset: number
    ): Promise<ShareSnap>
    receive(
      url: string,
      password: string,
      fileIds: string[],
      cid: string
    ): Promise<void>
    /** 文件夹 cid 第一页条目（新上传的在前） */
    entries(cid: string): Promise<DriveEntry[]>
    space(): Promise<DriveSpace>
    /** 删除文件夹 cid 里的一个文件 */
    remove(cid: string, fileId: string): Promise<void>
    /** 文件夹 cid 从根开始的各级名字（不含根） */
    dirPath(cid: string): Promise<string[]>
  }
  /** 设置里的转存目标 cid */
  defaultCid(): string
  load(): Promise<unknown>
  save(state: AutograbState): Promise<void>
  now(): number
  sleep(ms: number): Promise<void>
  emit(): void
  log(message: string): void
  /** 转存过的集入库了（日历里这一集有了文件），推送通知用 */
  landed?(records: EpisodeRecord[]): void
}

/** 与追更共用的 115 闸门和拉黑表（库外发现复用，不另起一套限速 / 熔断） */
export interface Pan115Guard {
  run<T>(kind: GateKind, task: () => Promise<T>): Promise<T>
  /** 闸门暂停的原因；没暂停为 null */
  pauseReason(): string | null
  blocked(shareCode: string): boolean
  block(shareCode: string): void
}
