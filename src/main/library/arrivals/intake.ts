/**
 * 组装「入库之后」的两件事：新入库宣布（交给宿主推送，arrivals-module.ts）与自动字幕（subtitles/）。
 * 只用 LibraryService 的公开能力（数据库、事件订阅、库列表、网盘判定），服务本身不认识它们。
 */
import type { LibraryArrival } from '../../../shared/library/arrivals'
import type { LibraryDb } from '../db/database'
import type { HttpFetch } from '../identify/identify-module'
import type { LibraryEnvSecrets } from '../platform/platform'
import { SETTING_KEYS, SettingsStore } from '../providers/settings-store'
import {
  type AutoSubtitleSettings,
  AutoSubtitles,
} from '../subtitles/auto-subtitles'
import { type OsFetch, OsSubtitleClient } from '../subtitles/os-subtitles'
import type { LibraryEvent, LibraryInfo } from '../../../shared/library/ipc'
import { ArrivalsModule } from './arrivals-module'

/** 宿主注入项（LibraryServiceOptions.intake）。 */
export interface IntakeOptions {
  /** 一批新入库（桌面端转给主进程推送）。 */
  onArrivals?: (arrivals: LibraryArrival[]) => void
  /** 自动字幕设置；不给时不做自动字幕。 */
  subtitleSettings?: () => Promise<AutoSubtitleSettings>
  /** ffprobe 读字幕流；不给时不看内封字幕。 */
  probeStreams?: (path: string) => Promise<unknown>
}

/** createIntake 用到的服务能力。 */
export interface IntakeHost {
  readonly db: LibraryDb
  subscribe(listener: (event: LibraryEvent) => void): () => void
  listLibraries(): LibraryInfo[]
  isCloudLibrary(libraryId: number): Promise<boolean>
}

/** 组装好的两个模块。 */
export interface Intake {
  arrivals: ArrivalsModule
  subtitles: AutoSubtitles | null
  start(): void
  close(): void
}

/** 用服务参数组装。 */
export function createIntake(
  options: {
    intake?: IntakeOptions
    identify?: { fetch?: HttpFetch; env?: LibraryEnvSecrets }
    log?: (message: string) => void
  },
  host: IntakeHost
): Intake {
  const { intake = {}, log } = options
  const settings = new SettingsStore(host.db)
  const subtitles = intake.subtitleSettings
    ? new AutoSubtitles({
        db: host.db,
        client: new OsSubtitleClient({
          fetch: (options.identify?.fetch ??
            globalThis.fetch) as unknown as OsFetch,
          apiKey: () =>
            settings.get(SETTING_KEYS.opensubtitlesKey) ??
            options.identify?.env?.opensubtitlesKey,
        }),
        settings: intake.subtitleSettings,
        isCloud: id => host.isCloudLibrary(id),
        probeStreams: intake.probeStreams,
        log,
      })
    : null
  const arrivals = new ArrivalsModule({
    db: host.db,
    subscribe: listener => host.subscribe(listener),
    autoIdentify: id =>
      host.listLibraries().find(lib => lib.id === id)?.automation.identify ??
      false,
    deliver: list => {
      intake.onArrivals?.(list)
      subtitles
        ?.enqueue(list)
        .catch(error => log?.(`自动字幕失败：${(error as Error).message}`))
    },
    log,
  })
  return {
    arrivals,
    subtitles,
    start() {
      // 没人要新入库（独立服务、测试）就不看事件
      if (intake.onArrivals || subtitles) arrivals.start()
      subtitles?.start()
    },
    close() {
      arrivals.close()
      subtitles?.close()
    },
  }
}
