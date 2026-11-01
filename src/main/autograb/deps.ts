/**
 * 追更服务的依赖：日历、媒体库通知、115 / PanSou、状态读写、时钟。由 index.ts 接到真实实现，测试可全部替换。
 */
import type { SeriesCategory } from '../../shared/contract/series-category'
import type {
  AutograbOverview,
  AutograbResult,
  AutograbSeriesPatch,
} from '../../shared/contract/autograb'
import type { AutograbPrefs } from '../../shared/contract/autograb-prefs'
import type {
  GrabPolicy,
  GrabPolicyPatch,
} from '../../shared/contract/grab-policy'
import type { NetdiskItem, ShareSnap } from '../../shared/contract/pan115'
import type { TargetFolder } from '../../shared/netdisk/target-folder'
import type {
  CalendarRequest,
  CalendarResult,
  FileChangeNotice,
} from '../../shared/library/ipc'
import type { DriveEntry, DriveSpace } from '../pan115/client'
import type { Gate, GateKind } from './gate'
import type { AutograbState, EpisodeRecord } from './state'

/** 依赖 */
export interface AutograbDeps {
  calendar(range: CalendarRequest): Promise<CalendarResult>
  /** 确认旧条目是否仍是媒体库里这部剧（条目 id 可能被别的条目复用，所以连剧名一起核对）；不可用或查询失败时不自动迁移。 */
  seriesExists?(seriesId: number, title: string): Promise<boolean>
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
  /** 剧没单独选文件夹时的转存目标（剧集默认目录，没设时沿用原转存目标，见 shared/netdisk/target-folder.ts） */
  defaultFolder(): TargetFolder
  load(): Promise<unknown>
  save(state: AutograbState): Promise<void>
  now(): number
  sleep(ms: number): Promise<void>
  emit(): void
  log(message: string): void
  /** 定时一轮的间隔（毫秒）；给界面算「下次检查」，不传则不报 */
  intervalMs?: number
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

/** 追更服务 */
export interface AutograbService {
  /** 跑一轮（已在跑时直接返回） */
  tick(): Promise<void>
  overview(): Promise<AutograbOverview>
  setEnabled(enabled: boolean): Promise<void>
  setSeries(
    seriesId: number,
    patch: AutograbSeriesPatch
  ): Promise<AutograbResult>
  setPrefs(prefs: AutograbPrefs): Promise<void>
  /** 设某个分类的默认文件夹；cid 为空串 = 清掉 */
  setCategoryFolder(
    category: SeriesCategory,
    cid: string,
    name: string
  ): Promise<void>
  policy(): Promise<GrabPolicy>
  setPolicy(patch: GrabPolicyPatch): Promise<AutograbResult>
  grab(key: string, index: number): Promise<AutograbResult>
  revert(key: string): Promise<AutograbResult>
  skip(key: string): Promise<void>
  retry(key: string): Promise<void>
  resume(): Promise<void>
  /** 状态加载后的闸门：洗版、电影追踪的 115 请求也走它（同一队列、同一份限额与熔断） */
  gate(): Promise<Gate>
  /** 这一集是不是追更转存的、还在等入库（推送据此把新集标成追更） */
  isSaved(seriesId: number, season: number, episode: number): boolean
  /** 共用的闸门与拉黑表（状态加载后才返回；库外发现用） */
  guard(): Promise<Pan115Guard>
}
