/**
 * 追更：剧集库里已匹配 TMDB 的剧，新集播出后自动去 PanSou 搜 115 分享，验过文件后只把那一集转存到
 * 这部剧的 115 文件夹，再由 CloudDrive2 变更通知（或主动通知）入库。只有桌面端（115 会话在主进程）。
 *
 * 每部剧三档：不追 / 待确认（搜到候选等用户点转存）/ 全自动（分数过线直接存，开启后前几集仍要确认）。
 */
import {
  ContractError,
  bool,
  call,
  defineDomain,
  event,
  int,
  oneOf,
  record,
  str,
} from './define'

/** 一部剧的追更方式 */
export const AUTOGRAB_MODES = ['off', 'confirm', 'auto'] as const
export type AutograbMode = (typeof AUTOGRAB_MODES)[number]

/** 一集的状态 */
export type AutograbStatus =
  /** 等下一次搜索 */
  | 'waiting'
  /** 有候选，等用户确认 */
  | 'found'
  /** 已转存，等入库 */
  | 'saved'
  /** 已入库（本地有这一集的文件） */
  | 'done'
  /** 搜够了期限也没找到 */
  | 'notFound'
  /** 用户跳过 */
  | 'skipped'

/** 一个候选：分享里认出是这一集的那个视频文件 */
export interface AutograbCandidate {
  shareUrl: string
  password: string
  /** 分享标题（PanSou 的 note） */
  shareTitle: string
  /** 115 里的文件 id */
  fileId: string
  fileName: string
  size: number
  /** 0–100 */
  score: number
  /** 加减分理由（给用户看） */
  reasons: string[]
}

/** 一部剧的追更设置 */
export interface AutograbSeries {
  seriesId: number
  title: string
  mode: AutograbMode
  /** 转存到的 115 文件夹 cid；空串 = 用设置里的转存目标 */
  cid: string
  /** 文件夹显示名 */
  cidName: string
  /** 已确认过几集（全自动模式下前几集仍要确认） */
  confirmed: number
}

/** 一集的追更记录 */
export interface AutograbEpisode {
  /** 剧 id:季:集 */
  key: string
  seriesId: number
  seriesTitle: string
  season: number
  episode: number
  airDate: string
  status: AutograbStatus
  /** 已搜索次数 */
  attempts: number
  /** 下一次搜索时间（毫秒时间戳）；不再搜时为 null */
  nextTry: number | null
  candidates: AutograbCandidate[]
  /** 最近一次失败的人话 */
  error: string | null
}

/** 追更总览 */
export interface AutograbOverview {
  /** 总开关 */
  enabled: boolean
  /** 熔断暂停：到这个时间前不发 115 请求；null = 没暂停 */
  pausedUntil: number | null
  pauseReason: string | null
  /** 115 已登录、PanSou 已填 */
  ready: { loggedIn: boolean; pansou: boolean }
  /** 今天已用的 115 次数 */
  today: { snaps: number; receives: number }
  /** 最近有播出的剧（含已追的） */
  series: AutograbSeries[]
  /** 已追的剧最近的集 */
  episodes: AutograbEpisode[]
  /** 正在跑一轮 */
  running: boolean
}

/** 改一部剧的设置 */
export interface AutograbSeriesPatch {
  mode?: AutograbMode
  cid?: string
  cidName?: string
}

/** 结果：成功或人话 */
export type AutograbResult = { ok: true } | { ok: false; error: string }

const patchOf = (value: unknown): AutograbSeriesPatch => {
  const raw = record<Record<string, unknown>>(value, 'patch')
  const patch: AutograbSeriesPatch = {}
  if (raw.mode !== undefined)
    patch.mode = oneOf(raw.mode, 'mode', AUTOGRAB_MODES)
  if (raw.cid !== undefined) {
    const cid = str(raw.cid, 'cid')
    if (cid && !/^\d+$/.test(cid)) throw new ContractError('参数 cid 应为数字')
    patch.cid = cid
  }
  if (raw.cidName !== undefined)
    patch.cidName = str(raw.cidName, 'cidName').slice(0, 500)
  return patch
}

/** 追更域 */
export const autograb = defineDomain(
  'autograb',
  {
    overview: call<AutograbOverview>(),
    setEnabled: call<[enabled: boolean], void>(a => [bool(a[0], 'enabled')]),
    setSeries: call<
      [seriesId: number, patch: AutograbSeriesPatch],
      AutograbResult
    >(a => [int(a[0], 'seriesId'), patchOf(a[1])]),
    /** 转存某一集的第 index 个候选 */
    grab: call<[key: string, index: number], AutograbResult>(a => [
      str(a[0], 'key'),
      int(a[1], 'index'),
    ]),
    /** 跳过某一集（不再搜） */
    skip: call<[key: string], void>(a => [str(a[0], 'key')]),
    /** 重新搜某一集（清掉拉黑以外的状态） */
    retry: call<[key: string], void>(a => [str(a[0], 'key')]),
    /** 立刻跑一轮 */
    runNow: call<void>(),
    /** 解除熔断 */
    resume: call<void>(),
  },
  { changed: event<void>() }
)
