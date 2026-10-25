/**
 * 网盘服务：pan115 域每个方法的实现，组合 PanSou 搜索、扫码登录与 115 客户端。
 *
 * 不依赖 Electron：fetch、设置读取、会话存取都由 index.ts 注入（会话 = safeStorage 密钥），测试可全部替换。
 * 返回给渲染层的只有账号名和 id，Cookie 不出主进程；失败一律返回 { ok: false, error: 人话 }。
 */
import type {
  NetdiskItem,
  Pan115Account,
  Pan115DirListing,
  Pan115LoginPoll,
  Pan115Result,
  ShareSnap,
} from '../../shared/contract/pan115'
import { type Pan115Session, create115Client } from './client'
import { LOGIN_EXPIRED_CODES, Pan115Error } from './errors'
import type { FetchLike } from './http'
import { searchPanSou } from './pansou'
import { type QrTicket, createQrLogin } from './qr-login'
import { type ShareRef, parseShareLink } from './share-link'

export type { Pan115Session } from './client'

/** 服务依赖 */
export interface Pan115ServiceDeps {
  fetch: FetchLike
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
}

const NOT_LOGGED_IN = '请先在设置 · 网盘里扫码登录 115'

/** 会话 → 渲染层看到的账号 */
function accountOf(session: Pan115Session | null): Pan115Account {
  return session
    ? { loggedIn: true, userId: session.userId, userName: session.userName }
    : { loggedIn: false }
}

/** 网盘服务：方法与 pan115 域一一对应 */
export interface Pan115Service {
  search(keyword: string): Promise<Pan115Result<{ items: NetdiskItem[] }>>
  account(): Promise<Pan115Account>
  loginStart(): Promise<Pan115Result<{ imageUrl: string }>>
  loginPoll(): Promise<Pan115LoginPoll>
  logout(): Promise<void>
  snap(url: string, password: string): Promise<Pan115Result<ShareSnap>>
  receive(url: string, password: string): Promise<Pan115Result>
  dirs(cid: string): Promise<Pan115Result<Pan115DirListing>>
}

/** 创建网盘服务 */
export function createPan115Service(deps: Pan115ServiceDeps): Pan115Service {
  const qr = createQrLogin(deps.fetch)
  /** 当前这张二维码；过期 / 取消 / 登录完成后清掉 */
  let ticket: QrTicket | null = null

  /** 把异常转成失败结果；115 说登录失效时顺手删掉保存的登录 */
  async function failure(
    error: unknown
  ): Promise<{ ok: false; error: string }> {
    if (error instanceof Pan115Error) {
      if (error.code !== undefined && LOGIN_EXPIRED_CODES.includes(error.code))
        await deps.session.write(null)
      return { ok: false, error: error.message }
    }
    return { ok: false, error: `请求失败：${(error as Error).message}` }
  }

  /** 需要登录的操作：未登录直接返回提示，不发请求 */
  async function withClient<T extends object>(
    run: (client: ReturnType<typeof create115Client>) => Promise<T>
  ): Promise<Pan115Result<T>> {
    const session = deps.session.read()
    if (!session) return { ok: false, error: NOT_LOGGED_IN }
    try {
      return { ok: true, ...(await run(create115Client(deps.fetch, session))) }
    } catch (error) {
      return failure(error)
    }
  }

  /** 链接 + 密码 → 分享；不是 115 分享时抛人话 */
  function shareOf(url: string, password: string): ShareRef {
    const ref = parseShareLink(url, password)
    if (!ref) throw new Pan115Error('不是 115 分享链接')
    return ref
  }

  return {
    async search(
      keyword: string
    ): Promise<Pan115Result<{ items: NetdiskItem[] }>> {
      const base = deps.settings.pansouUrl().trim()
      if (!base)
        return { ok: false, error: '请先在设置 · 网盘里填写 PanSou 地址' }
      if (!keyword.trim()) return { ok: false, error: '请输入关键词' }
      try {
        return {
          ok: true,
          items: await searchPanSou(deps.fetch, base, keyword),
        }
      } catch (error) {
        return failure(error)
      }
    },

    async account(): Promise<Pan115Account> {
      return accountOf(deps.session.read())
    },

    async loginStart(): Promise<Pan115Result<{ imageUrl: string }>> {
      try {
        ticket = await qr.start()
        return { ok: true, imageUrl: ticket.imageUrl }
      } catch (error) {
        ticket = null
        return failure(error)
      }
    },

    async loginPoll(): Promise<Pan115LoginPoll> {
      const current = ticket
      if (!current) return { status: 'error', error: '请先获取二维码' }
      try {
        const status = await qr.poll(current)
        if (status === 'waiting' || status === 'scanned') return { status }
        if (ticket === current) ticket = null
        if (status === 'expired' || status === 'canceled') return { status }
        if (status === 'error')
          return { status: 'error', error: '二维码状态异常，请重新获取' }
        const session = await qr.finish(current)
        await deps.session.write(session)
        return { status: 'done', account: accountOf(session) }
      } catch (error) {
        // 状态接口是长轮询，超时只说明还没扫
        if (error instanceof Pan115Error && error.timeout && ticket === current)
          return { status: 'waiting' }
        return { status: 'error', error: (await failure(error)).error }
      }
    },

    async logout(): Promise<void> {
      ticket = null
      await deps.session.write(null)
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
  }
}
