/**
 * 主进程网盘模块入口：用 Electron net.fetch、设置与 safeStorage 密钥组装 {@link createPan115Service}，注册 pan115 域。
 *
 * - 登录会话存在密钥 pan115.session（safeStorage 加密），明文只在主进程内存；不写日志。
 * - net.fetch 走系统代理；credentials: 'omit'，Cookie 只用请求头里显式给的这一份。
 * - PanSou 可能自部署在局域网（NAS），所以不走 SSRF 防护的出网口。
 */
import { net } from 'electron'

import { pan115 } from '../../shared/contract/pan115'
import { implement } from '../rpc'
import { settingsStore } from '../settings'
import { type Pan115Session, createPan115Service } from './service'

const SESSION_KEY = 'pan115.session'

/** 读保存的会话；没有或格式不对时为 null */
function readSession(raw: string): Pan115Session | null {
  if (!raw) return null
  try {
    const data = JSON.parse(raw) as Partial<Pan115Session>
    return typeof data.cookie === 'string' && data.cookie
      ? {
          cookie: data.cookie,
          userId: String(data.userId ?? ''),
          userName: String(data.userName ?? ''),
        }
      : null
  } catch {
    return null
  }
}

/** 注册 pan115 域（initSettings 之后调用一次） */
export function registerPan115(): void {
  const store = settingsStore()
  const service = createPan115Service({
    fetch: (url, init) => net.fetch(url, { ...init, credentials: 'omit' }),
    settings: {
      pansouUrl: () => store.get('pan115.pansouUrl'),
      targetCid: () => store.get('pan115.targetCid'),
    },
    session: {
      read: () => readSession(store.getSecret(SESSION_KEY)),
      write: session =>
        store.setSecret(SESSION_KEY, session ? JSON.stringify(session) : ''),
    },
  })
  implement(pan115, {
    search: (_, keyword) => service.search(keyword),
    account: () => service.account(),
    loginStart: () => service.loginStart(),
    loginPoll: () => service.loginPoll(),
    logout: () => service.logout(),
    snap: (_, url, password) => service.snap(url, password),
    receive: (_, url, password) => service.receive(url, password),
    dirs: (_, cid) => service.dirs(cid),
  })
}
