/**
 * 主进程网盘模块入口：组装 {@link createPan115Service}，注册 pan115 域。
 *
 * - 115 请求走独立分区 persist:pan115（session-transport.ts）：Cookie 写进分区、Referer / UA 由分区补上，
 *   不依赖手写受保护请求头；分区装公网限制（与代抓会话同一个守卫），重定向到内网会被拦下。
 * - 登录会话存在密钥 pan115.session（safeStorage 加密），是 Cookie 的权威来源：启动时恢复进分区，
 *   退出时清掉分区 Cookie；明文只在主进程内存，不写日志。
 * - PanSou 是用户填的地址（可能是局域网 NAS），走默认会话的 net.fetch（credentials: 'omit'），
 *   不做私网拦截，但重定向只跟同一主机（见 pansou.ts）。
 */
import { app, net, session } from 'electron'

import { pan115 } from '../../shared/contract/pan115'
import { installBrowserNetworkGuard } from '../browser-fetch/network-guard'
import { implement } from '../rpc'
import { settingsStore } from '../settings'
import { createPan115Service } from './service'
import { parseSession, serializeSession } from './session-codec'
import { PAN115_PARTITION, createSessionTransport } from './session-transport'

const SESSION_KEY = 'pan115.session'

/** 注册 pan115 域（app ready、initSettings 之后调用一次） */
export function registerPan115(): void {
  const store = settingsStore()
  const partition = session.fromPartition(PAN115_PARTITION)
  installBrowserNetworkGuard(partition)
  const transport = createSessionTransport(partition)
  const service = createPan115Service({
    transport,
    pansouFetch: (url, init) =>
      net.fetch(url, { ...init, credentials: 'omit' }),
    settings: {
      pansouUrl: () => store.get('pan115.pansouUrl'),
      targetCid: () => store.get('pan115.targetCid'),
    },
    session: {
      read: () => parseSession(store.getSecret(SESSION_KEY)),
      write: value => store.setSecret(SESSION_KEY, serializeSession(value)),
    },
  })
  void service.restore().catch(() => {})
  // 分区 Cookie 不设过期本就不落盘；退出时再清一次，不留副本
  app.on('will-quit', () => void transport.clear().catch(() => {}))
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
