/** 代抓会话的每次网络请求（含跳转与子资源）都遵守公网限制。 */
import { lookup } from 'node:dns/promises'
import { type Session, session } from 'electron'
import { type LookupAll, assertPublicTarget } from '../../shared/net/guard'
import { PARTITION } from './page'
import { installPermissionPolicy } from '../permissions'

const installed = new WeakSet<Session>()

export function installBrowserNetworkGuard(
  target: Session,
  resolve: LookupAll = host => lookup(host, { all: true })
): void {
  if (installed.has(target)) return
  installPermissionPolicy(target)
  target.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      void assertPublicTarget(details.url, resolve).then(
        () => callback({ cancel: false }),
        () => callback({ cancel: true })
      )
    }
  )
  installed.add(target)
}

export function guardedBrowserSession(): Session {
  const target = session.fromPartition(PARTITION)
  installBrowserNetworkGuard(target)
  return target
}
