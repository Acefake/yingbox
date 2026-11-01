/**
 * 追更：剧集库里已匹配 TMDB 的剧，新集播出后自动去 PanSou 搜 115 分享，验过文件后只把那一集转存到
 * 这部剧的 115 文件夹，再由 CloudDrive2 变更通知（或主动通知）入库。只有桌面端（115 会话在主进程）。
 *
 * 方式三档：不追 / 待确认（搜到候选等用户点转存）/ 全自动（匹配分过线直接存，每部剧前几集仍要确认）。
 * 剧集的全局策略（默认方式、新剧先确认几集、资源偏好，见 grab-policy.ts）管所有在播的剧；
 * 每部剧「跟随全局」（inherit）或单独设方式 / 偏好。
 */
import { SERIES_CATEGORIES, type SeriesCategory } from './series-category'
import {
  type AutograbPrefs,
  type AutograbPrefsOverride,
  prefsOf,
  prefsOverrideOf,
} from './autograb-prefs'
import {
  GRAB_MODES,
  type GrabModeSetting,
  type GrabPolicy,
  type GrabPolicyPatch,
  policyPatchOf,
} from './grab-policy'
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
export const AUTOGRAB_MODES = GRAB_MODES
export type AutograbMode = (typeof AUTOGRAB_MODES)[number]

/** 一部剧的方式设置：跟随全局，或单独设一种 */
export const AUTOGRAB_SERIES_MODES = ['inherit', ...GRAB_MODES] as const
export type AutograbSeriesMode = GrabModeSetting

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
  /** 115 剩余空间不够存这个候选（候选保留，清理空间后可再转存） */
  | 'noSpace'

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
  /** 匹配分 0–100：有多确定是这一集，过线才允许全自动 */
  score: number
  /** 版本分 0–100：画质合不合资源偏好，用来挑版本（老记录为 0） */
  quality: number
  /** 短规格（4K · WEB · DV · 中字） */
  specs: string[]
  /** 加分理由（给用户看） */
  reasons: string[]
}

/** 一部剧的追更设置 */
export interface AutograbSeries {
  seriesId: number
  title: string
  /** 方式设置：inherit = 跟随全局 */
  mode: AutograbSeriesMode
  /** 实际生效的方式 */
  effectiveMode: AutograbMode
  /** 全自动前要手动确认几集（全局「新剧先确认」，单独设过的老剧可能自带门槛） */
  confirmFirst: number
  /** 这部剧单独选的 115 文件夹 cid；空串 = 用剧集默认目录（没设时沿用原转存目标） */
  cid: string
  /** 文件夹显示名 */
  cidName: string
  /** 已确认过几集（全自动模式下前几集仍要确认） */
  confirmed: number
  /** 这部剧覆盖了哪些偏好（空对象 = 全跟随全局） */
  prefs: AutograbPrefsOverride
  /** 下一集的播出日期 YYYY-MM-DD；日历里没有未播出的集为 null */
  nextAirDate?: string | null
  /** 剧的海报（片库条目的 poster 原样，界面按片库图片规则换地址）；近期日历里没有这部剧时为 null */
  poster?: string | null
  /** 分类（按 TMDB 类型）；近期日历里没有这部剧、或旧版片库服务不给时没有 */
  category?: SeriesCategory
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
  /** 已转存且已主动通知媒体库扫描（日历卡片显示「入库中」） */
  notified: boolean
  /** 能撤销：是追更存进 115 的，并记下了那个文件的 id */
  revertable: boolean
}

/** 追更总览 */
export interface AutograbOverview {
  /** 总开关 */
  enabled: boolean
  /** 熔断暂停：到这个时间前不发 115 请求；null = 没暂停 */
  pausedUntil: number | null
  pauseReason: string | null
  /** 115 空间不足时自动转存暂停的原因；null = 没暂停 */
  spacePaused: string | null
  /** 剧集的全局策略 */
  policy: GrabPolicy
  /** 全局偏好（= policy.prefs） */
  prefs: AutograbPrefs
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
  /** 要用户处理的集数：有候选待确认、空间不足、找不到（全部记录，不止 episodes 里列的；片库服务没给时为 undefined） */
  pendingCount?: number
  /** 上一轮结束的时间（毫秒时间戳）；还没跑过为 null */
  lastRunAt?: number | null
  /** 下一轮预计开始的时间；不会再跑（总开关关闭）或不知道为 null */
  nextRunAt?: number | null
  /** 各分类默认存到哪（没设的分类用剧集默认目录） */
  categoryFolders?: Partial<
    Record<SeriesCategory, { cid: string; name: string }>
  >
  /** 没单独选文件夹的剧存到哪（剧集默认目录，没设时沿用原转存目标；根目录 cid 为 "0"） */
  defaultFolder: { cid: string; name: string }
}

/** 改一部剧的设置 */
export interface AutograbSeriesPatch {
  /** 剧名：这部剧还没有设置、近期日历里也没有它时，新建设置用它当名字 */
  title?: string
  mode?: AutograbSeriesMode
  cid?: string
  cidName?: string
  /** 整份替换这部剧的覆盖项（{} = 全跟随全局） */
  prefs?: AutograbPrefsOverride
}

/** 结果：成功或人话 */
export type AutograbResult = { ok: true } | { ok: false; error: string }

const patchOf = (value: unknown): AutograbSeriesPatch => {
  const raw = record<Record<string, unknown>>(value, 'patch')
  const patch: AutograbSeriesPatch = {}
  if (raw.title !== undefined)
    patch.title = str(raw.title, 'title').slice(0, 200)
  if (raw.mode !== undefined)
    patch.mode = oneOf(raw.mode, 'mode', AUTOGRAB_SERIES_MODES)
  if (raw.cid !== undefined) {
    const cid = str(raw.cid, 'cid')
    if (cid && !/^\d+$/.test(cid)) throw new ContractError('参数 cid 应为数字')
    patch.cid = cid
  }
  if (raw.cidName !== undefined)
    patch.cidName = str(raw.cidName, 'cidName').slice(0, 500)
  if (raw.prefs !== undefined) patch.prefs = prefsOverrideOf(raw.prefs)
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
    /** 剧集的全局策略 */
    policy: call<GrabPolicy>(),
    /**
     * 改剧集的全局策略。切全自动而剧集默认目录解析到根目录时拒绝（界面先让用户选目录）。
     */
    setPolicy: call<[patch: GrabPolicyPatch], AutograbResult>(a => [
      policyPatchOf(record(a[0], 'patch'), 'tv'),
    ]),
    /** 改全局偏好（整份替换；= setPolicy({ prefs })） */
    setPrefs: call<[prefs: AutograbPrefs], void>(a => [
      prefsOf(record(a[0], 'prefs')),
    ]),
    /** 撤销已转存的一集：删掉 115 上那个文件、拉黑这个候选、回到缺集 */
    revert: call<[key: string], AutograbResult>(a => [str(a[0], 'key')]),
    /** 跳过某一集（不再搜） */
    skip: call<[key: string], void>(a => [str(a[0], 'key')]),
    /** 重新搜某一集（清掉拉黑以外的状态） */
    retry: call<[key: string], void>(a => [str(a[0], 'key')]),
    /** 设某个分类的默认文件夹；cid 为空串 = 清掉，回到剧集默认目录 */
    setCategoryFolder: call<
      [category: SeriesCategory, cid: string, cidName: string],
      void
    >(a => {
      const cid = str(a[1], 'cid')
      if (cid && !/^d+$/.test(cid)) throw new ContractError('参数 cid 应为数字')
      return [
        oneOf(a[0], 'category', SERIES_CATEGORIES),
        cid,
        str(a[2], 'cidName').slice(0, 500),
      ]
    }),
    /** 立刻跑一轮 */
    runNow: call<void>(),
    /** 解除熔断与空间不足暂停 */
    resume: call<void>(),
  },
  { changed: event<void>() }
)
