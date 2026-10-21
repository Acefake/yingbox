/**
 * 媒体库 IPC 契约 · 演员库：番号库影片里出现的演员、聚合后的资料、用户锁定字段、资料来源设置。
 *
 * 只有类型、常量和一个把 call 包成 bridge 的小函数，由 contract.ts 统一再导出；
 * preload 与网页端 transport 共用 createActorsBridge，两边方法一一对应。
 */

/** 内置的演员资料来源（与引擎 providers/jav/actors 的来源一一对应）。 */
export type ActorSourceId =
  | 'gfriends'
  | 'avbase'
  | 'minnano'
  | 'javdb'
  | 'wikipedia'
  | 'theporndb'

export type ActorGender = 'female' | 'male'

/** 来源显示名与说明（设置页用）。顺序即默认优先级。 */
export const ACTOR_SOURCES: ReadonlyArray<{
  id: ActorSourceId
  name: string
  description: string
  /** image = 只有头像；profile = 资料（可能附带头像）。 */
  capability: 'image' | 'profile'
}> = [
  {
    id: 'gfriends',
    name: 'gfriends',
    description:
      '社区整理的女优头像库，只提供头像，索引约 6 MB，首次使用时下载',
    capability: 'image',
  },
  {
    id: 'avbase',
    name: 'AVBase',
    description: '别名、生日、身高三围，资料较全',
    capability: 'profile',
  },
  {
    id: 'minnano',
    name: 'みんなのAV',
    description: '女优资料库：别名、读音、出身地、三围罩杯',
    capability: 'profile',
  },
  {
    id: 'javdb',
    name: 'JavDB',
    description: '头像与别名；Cloudflare 防护较严',
    capability: 'profile',
  },
  {
    id: 'wikipedia',
    name: '维基百科',
    description: '日文 / 中文维基与维基数据，补简介',
    capability: 'profile',
  },
  {
    id: 'theporndb',
    name: 'ThePornDB',
    description: '需填写 API 令牌（与番号站点共用），欧美演员较多',
    capability: 'profile',
  },
]

/** 演员资料设置：数组顺序即优先级；autoLookup 关掉后只在手动刷新时查资料。 */
export interface ActorSettings {
  sources: Array<{ id: ActorSourceId; enabled: boolean }>
  autoLookup: boolean
}

/** 默认：全部来源按 ACTOR_SOURCES 顺序开启，影片入库后自动查资料。 */
export const DEFAULT_ACTOR_SETTINGS: ActorSettings = {
  sources: ACTOR_SOURCES.map(s => ({ id: s.id, enabled: true })),
  autoLookup: true,
}

/** 用户可以手动编辑（并锁定）的字段。 */
export type ActorField =
  | 'aliases'
  | 'gender'
  | 'birthday'
  | 'birthplace'
  | 'height'
  | 'bust'
  | 'waist'
  | 'hip'
  | 'cup'
  | 'overview'
  | 'images'

/** 全部可编辑字段，校验与界面用。 */
export const ACTOR_FIELDS: readonly ActorField[] = [
  'aliases',
  'gender',
  'birthday',
  'birthplace',
  'height',
  'bust',
  'waist',
  'hip',
  'cup',
  'overview',
  'images',
]

/** 资料字段的值（缺失为 null，列表为空数组）。 */
export interface ActorProfileValues {
  aliases: string[]
  gender: ActorGender | null
  /** YYYY-MM-DD。 */
  birthday: string | null
  birthplace: string | null
  /** cm。 */
  height: number | null
  bust: number | null
  waist: number | null
  hip: number | null
  /** 罩杯，大写字母。 */
  cup: string | null
  overview: string | null
  /** 头像远程地址，首选在前。 */
  images: string[]
}

/** 资料查询状态：pending 还没查过，found 至少一个来源命中，missing 都查无此人，error 来源都失败。 */
export type ActorProfileState = 'pending' | 'found' | 'missing' | 'error'

/** 演员列表里的一项。 */
export interface ActorSummary {
  id: number
  name: string
  /** 首选头像：yingbox-media://（已缓存）或远程地址；没有为 null。 */
  photo: string | null
  gender: ActorGender | null
  /** 关联的作品数（顶层条目）。 */
  workCount: number
}

/** 演员详情。 */
export interface ActorDetail extends ActorSummary, ActorProfileValues {
  /** 一句话身份描述（维基数据）。 */
  tagline: string | null
  /** 各站 id（avbase / wikidata / twitter …）。 */
  ids: Record<string, string>
  /** 各来源的资料页。 */
  urls: Partial<Record<ActorSourceId, string>>
  /** 每个字段取自哪个来源；用户编辑过的为 user。 */
  fieldSources: Partial<Record<ActorField | 'tagline', ActorSourceId | 'user'>>
  /** 锁定的字段：自动刷新不再覆盖。 */
  lockedFields: ActorField[]
  profileState: ActorProfileState
  /** 最近一次查资料的时间；没查过为 null。 */
  profileAt: number | null
  updatedAt: number
}

/** 演员列表排序：名字、作品数、最近入库。 */
export type ActorSortField = 'name' | 'works' | 'recent'

/** 演员列表查询。 */
export interface ActorListQuery {
  /** 只看某个媒体库里的作品；缺省全部番号库。 */
  libraryId?: number
  /** 按名字 / 别名搜索。 */
  search?: string
  /** 默认 works（作品多的在前）。 */
  sort?: ActorSortField
  offset?: number
  /** 默认 500，上限 1000。 */
  limit?: number
}

/** 演员列表结果。 */
export interface ActorListResult {
  items: ActorSummary[]
  total: number
  offset: number
  limit: number
}

/**
 * 手动编辑：values 里出现的字段写入（null / 空数组表示清空），lockedFields 整体替换锁定集合。
 * 界面编辑某字段时默认把它加进锁定，用户可以再解锁。
 */
export interface UpdateActorRequest {
  actorId: number
  values: Partial<ActorProfileValues>
  lockedFields: ActorField[]
}

/** 刷新演员资料（忽略缓存）。actorIds 缺省为全部有作品的演员。 */
export interface RefreshActorsRequest {
  actorIds?: number[]
}

/** 演员资料变化（查到资料 / 手动编辑 / 作品关联变化）。数量过多时只发 reset。 */
export interface ActorsChangedEvent {
  type: 'actors-changed'
  actorIds: number[]
  reset: boolean
}

/** 演员库的方法：方法名 → 参数与返回值（并入 LibraryRpcMap）。 */
export interface ActorRpcMap {
  'actors.list': { params: ActorListQuery; result: ActorListResult }
  'actors.get': { params: { actorId: number }; result: ActorDetail | null }
  'actors.forItem': { params: { itemId: number }; result: ActorSummary[] }
  'actors.update': { params: UpdateActorRequest; result: ActorDetail }
  'actors.refresh': {
    params: RefreshActorsRequest
    result: { jobId: number }
  }
  'actors.cancelRefresh': { params: void; result: { cancelled: number } }
  'actors.getSettings': { params: void; result: ActorSettings }
  'actors.setSettings': { params: ActorSettings; result: ActorSettings }
}

export type ActorMethod = keyof ActorRpcMap

/** 方法名白名单（并入 LIBRARY_METHODS）。 */
export const ACTOR_METHODS = [
  'actors.list',
  'actors.get',
  'actors.forItem',
  'actors.update',
  'actors.refresh',
  'actors.cancelRefresh',
  'actors.getSettings',
  'actors.setSettings',
] as const satisfies readonly ActorMethod[]

/** window.api.library.actors。 */
export interface LibraryActorsBridge {
  list(query?: ActorListQuery): Promise<ActorListResult>
  get(actorId: number): Promise<ActorDetail | null>
  /** 条目的演员（按演员表顺序）；不是番号库条目为空。 */
  forItem(itemId: number): Promise<ActorSummary[]>
  update(request: UpdateActorRequest): Promise<ActorDetail>
  /** 排一个低优先级的刷新任务（进度见 job 事件，jobType 为 actor-profile）。 */
  refresh(actorIds?: number[]): Promise<{ jobId: number }>
  /** 取消排队中 / 运行中的演员资料任务。 */
  cancelRefresh(): Promise<{ cancelled: number }>
  getSettings(): Promise<ActorSettings>
  setSettings(settings: ActorSettings): Promise<ActorSettings>
}

/** transport 的调用函数（preload 的 IPC / 网页端的 HTTP）。 */
export type ActorCall = <M extends ActorMethod>(
  method: M,
  params?: ActorRpcMap[M]['params']
) => Promise<ActorRpcMap[M]['result']>

/** 用 transport 的 call 组装 actors bridge。 */
export function createActorsBridge(call: ActorCall): LibraryActorsBridge {
  return {
    list: (query = {}) => call('actors.list', query),
    get: actorId => call('actors.get', { actorId }),
    forItem: itemId => call('actors.forItem', { itemId }),
    update: request => call('actors.update', request),
    refresh: actorIds => call('actors.refresh', actorIds ? { actorIds } : {}),
    cancelRefresh: () => call('actors.cancelRefresh'),
    getSettings: () => call('actors.getSettings'),
    setSettings: settings => call('actors.setSettings', settings),
  }
}
