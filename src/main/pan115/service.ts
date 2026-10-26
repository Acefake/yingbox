/**
 * 网盘服务：pan115 域每个方法的实现，组合 PanSou / Torznab 搜索、扫码登录与 115 客户端。
 *
 * 不依赖 Electron：115 传输层、局域网地址（PanSou / Torznab）的 fetch、设置读取、会话与 Torznab 配置的存取都由 index.ts 注入
 * （会话 = safeStorage 密钥，是 Cookie 的权威来源；传输层分区里的 Cookie 只是它的副本，
 * 每次发 115 请求前按当前会话同步），测试可全部替换。
 * 返回给渲染层的只有账号名和 id，Cookie 与 Torznab API Key 不出主进程；失败一律返回 { ok: false, error: 人话 }。
 * 界面搜索与 Torznab 配置在 sources.ts。
 *
 * 扫码状态机：二维码只在终态（登录完成 / 过期 / 取消）或换新码时作废；状态接口的瞬时异常
 * 连续 {@link MAX_MISSES} 次才报错且保留二维码；手机确认后换 Cookie 失败时，下一次轮询直接重试换 Cookie。
 */
import type {
  NetdiskItem,
  Pan115Account,
  Pan115DirListing,
  Pan115LoginPoll,
  Pan115Result,
  ShareSnap,
} from '../../shared/contract/pan115'
import {
  type Pan115Client,
  type Pan115Session,
  create115Client,
} from './client'
import { LOGIN_EXPIRED_CODES, Pan115Error } from './errors'
import type { FetchLike } from './http'
import { searchPanSou } from './pansou'
import { type QrStatus, type QrTicket, createQrLogin } from './qr-login'
import { type ShareRef, parseShareLink } from './share-link'
import { type SourceSearch, createSourceSearch } from './sources'
import type { TorznabSecret } from './torznab-secret'
import type { Pan115Transport } from './transport'

export type { Pan115Session } from './client'

/** 服务依赖 */
export interface Pan115ServiceDeps {
  /** 115 域请求（独立分区：Cookie / Referer / UA 由它带上） */
  transport: Pan115Transport
  /** PanSou / Torznab 请求（用户填的局域网地址，与 115 分开） */
  lanFetch: FetchLike
  settings: {
    /** PanSou 地址（空串 = 未填） */
    pansouUrl(): string
    /** 转存目标文件夹 cid（"0" = 根目录） */
    targetCid(): string
  }
  /** 登录会话的存取 */
  session: {
    read(): Pan115Session | null
    write(session: Pan115Session | null): Promise<void>
  }
  /** Torznab 地址与 API Key 的存取（与 115 会话同一种密钥存储） */
  torznab: {
    read(): TorznabSecret | null
    write(value: TorznabSecret | null): Promise<void>
  }
}

const NOT_LOGGED_IN = '请先在设置 · 网盘里扫码登录 115'
const QR_REPLACED = '二维码已刷新，请扫新的二维码'
/** 状态接口连续几次瞬时异常才报错 */
const MAX_MISSES = 3

/** 进行中的一次扫码 */
interface LoginAttempt {
  ticket: QrTicket
  /** 上一次的非终态状态（瞬时异常时照报它） */
  last: 'waiting' | 'scanned'
  /** 连续瞬时异常次数 */
  misses: number
  /** 手机已确认：之后的轮询直接换 Cookie，不再查状态 */
  confirmed: boolean
  /** 进行中的换 Cookie（并发轮询共用一次） */
  finishing?: Promise<Pan115LoginPoll>
}

/** 会话 → 渲染层看到的账号 */
function accountOf(session: Pan115Session | null): Pan115Account {
  return session
    ? { loggedIn: true, userId: session.userId, userName: session.userName }
    : { loggedIn: false }
}

/** 网盘服务：方法与 pan115 域一一对应 */
export interface Pan115Service {
  search: SourceSearch['search']
  torznab: SourceSearch['torznab']
  setTorznab: SourceSearch['setTorznab']
  testTorznab: SourceSearch['testTorznab']
  account(): Promise<Pan115Account>
  loginStart(): Promise<Pan115Result<{ imageUrl: string }>>
  loginPoll(): Promise<Pan115LoginPoll>
  logout(): Promise<void>
  snap(url: string, password: string): Promise<Pan115Result<ShareSnap>>
  receive(url: string, password: string): Promise<Pan115Result>
  dirs(cid: string): Promise<Pan115Result<Pan115DirListing>>
  /** 启动时把保存的会话 Cookie 恢复进传输层分区（没有会话时清空分区） */
  restore(): Promise<void>
  /**
   * 主进程内直接用 115 客户端（追更）：未登录或请求失败时抛 {@link Pan115Error}（保留 errno），
   * 登录失效的处理与界面调用相同。
   */
  use<T>(run: (client: Pan115Client) => Promise<T>): Promise<T>
  /** 主进程内直接搜 PanSou（追更）：失败时抛 {@link Pan115Error} */
  searchRaw(keyword: string): Promise<NetdiskItem[]>
}

/** 创建网盘服务 */
export function createPan115Service(deps: Pan115ServiceDeps): Pan115Service {
  const qr = createQrLogin(deps.transport.fetch)
  const sources = createSourceSearch(deps)
  let attempt: LoginAttempt | null = null
  /** 分区里当前是哪份 Cookie（undefined = 未知，下次必同步） */
  let applied: string | null | undefined
  /** 串行化对分区 Cookie 的改动，免得「清空 → 写入」交错 */
  let syncing: Promise<void> = Promise.resolve()

  /** 让分区 Cookie 与给定会话一致（同一份时不重复写） */
  function useCookie(cookie: string | null): Promise<void> {
    if (applied === cookie) return syncing
    applied = cookie
    syncing = syncing
      .catch(() => {})
      .then(() => deps.transport.useCookie(cookie))
      .catch(error => {
        applied = undefined
        throw error
      })
    return syncing
  }

  /** 保存（或清除）会话，并同步分区 Cookie */
  async function saveSession(session: Pan115Session | null): Promise<void> {
    await deps.session.write(session)
    await useCookie(session?.cookie ?? null)
  }

  /**
   * 把异常转成失败结果。115 说登录失效时，只在保存的仍是发请求时那份 Cookie 才清除，
   * 免得晚到的失效响应删掉期间重新扫码得到的新会话。
   */
  async function failure(
    error: unknown,
    cookie?: string
  ): Promise<{ ok: false; error: string }> {
    if (error instanceof Pan115Error) {
      if (
        cookie !== undefined &&
        error.code !== undefined &&
        LOGIN_EXPIRED_CODES.includes(error.code) &&
        deps.session.read()?.cookie === cookie
      )
        await saveSession(null)
      return { ok: false, error: error.message }
    }
    return { ok: false, error: `请求失败：${(error as Error).message}` }
  }

  /** 需要登录的操作：未登录直接返回提示，不发请求；发请求前同步分区 Cookie */
  async function withClient<T extends object>(
    run: (client: ReturnType<typeof create115Client>) => Promise<T>
  ): Promise<Pan115Result<T>> {
    const session = deps.session.read()
    if (!session) return { ok: false, error: NOT_LOGGED_IN }
    try {
      await useCookie(session.cookie)
      return {
        ok: true,
        ...(await run(create115Client(deps.transport.fetch, session))),
      }
    } catch (error) {
      return failure(error, session.cookie)
    }
  }

  /** 链接 + 密码 → 分享；不是 115 分享时抛人话 */
  function shareOf(url: string, password: string): ShareRef {
    const ref = parseShareLink(url, password)
    if (!ref) throw new Pan115Error('不是 115 分享链接')
    return ref
  }

  /** 一次瞬时异常：未到上限照报上次状态；到上限报错，但二维码保留可重试 */
  function miss(current: LoginAttempt, reason: string): Pan115LoginPoll {
    current.misses++
    if (current.misses < MAX_MISSES) return { status: current.last }
    current.misses = 0
    return { status: 'error', error: `${reason}，可点重试继续` }
  }

  /** 手机确认后换 Cookie；失败时保留二维码，下次轮询再试 */
  async function finish(current: LoginAttempt): Promise<Pan115LoginPoll> {
    try {
      const session = await qr.finish(current.ticket)
      if (attempt !== current) return { status: 'error', error: QR_REPLACED }
      attempt = null
      await saveSession(session)
      return { status: 'done', account: accountOf(session) }
    } catch (error) {
      current.finishing = undefined
      const reason = error instanceof Error ? error.message : String(error)
      return {
        status: 'error',
        error: `手机已确认，但换取登录信息失败（${reason}），可点重试继续`,
      }
    }
  }

  return {
    ...sources,

    async account(): Promise<Pan115Account> {
      return accountOf(deps.session.read())
    },

    async loginStart(): Promise<Pan115Result<{ imageUrl: string }>> {
      attempt = null
      try {
        const ticket = await qr.start()
        attempt = { ticket, last: 'waiting', misses: 0, confirmed: false }
        return { ok: true, imageUrl: ticket.imageUrl }
      } catch (error) {
        return failure(error)
      }
    },

    async loginPoll(): Promise<Pan115LoginPoll> {
      const current = attempt
      if (!current) return { status: 'error', error: '请先获取二维码' }
      if (!current.confirmed) {
        let status: QrStatus
        try {
          status = await qr.poll(current.ticket)
        } catch (error) {
          if (attempt !== current)
            return { status: 'error', error: QR_REPLACED }
          // 状态接口是长轮询，超时只说明状态没变
          if (error instanceof Pan115Error && error.timeout)
            return { status: current.last }
          return miss(current, (await failure(error)).error)
        }
        if (attempt !== current) return { status: 'error', error: QR_REPLACED }
        if (status === 'waiting' || status === 'scanned') {
          current.last = status
          current.misses = 0
          return { status }
        }
        if (status === 'expired' || status === 'canceled') {
          attempt = null
          return { status }
        }
        if (status === 'error') return miss(current, '二维码状态异常')
        current.confirmed = true
      }
      current.finishing ??= finish(current)
      return current.finishing
    },

    async logout(): Promise<void> {
      attempt = null
      await saveSession(null)
    },

    snap(url: string, password: string): Promise<Pan115Result<ShareSnap>> {
      return withClient(client => client.snap(shareOf(url, password)))
    },

    receive(url: string, password: string): Promise<Pan115Result> {
      const cid = deps.settings.targetCid()
      return withClient(async client => {
        await client.receive(
          shareOf(url, password),
          /^\d+$/.test(cid) ? cid : '0'
        )
        return {}
      })
    },

    dirs(cid: string): Promise<Pan115Result<Pan115DirListing>> {
      return withClient(client => client.dirs(/^\d+$/.test(cid) ? cid : '0'))
    },

    restore(): Promise<void> {
      return useCookie(deps.session.read()?.cookie ?? null)
    },

    async use<T>(run: (client: Pan115Client) => Promise<T>): Promise<T> {
      const session = deps.session.read()
      if (!session) throw new Pan115Error(NOT_LOGGED_IN)
      try {
        await useCookie(session.cookie)
        return await run(create115Client(deps.transport.fetch, session))
      } catch (error) {
        await failure(error, session.cookie)
        throw error
      }
    },

    async searchRaw(keyword: string): Promise<NetdiskItem[]> {
      const base = deps.settings.pansouUrl().trim()
      if (!base) throw new Pan115Error('请先在设置 · 网盘里填写 PanSou 地址')
      return (await searchPanSou(deps.lanFetch, base, keyword)).shares
    },
  }
}
