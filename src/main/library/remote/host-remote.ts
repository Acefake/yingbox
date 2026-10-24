/**
 * 媒体库引擎（utilityProcess）里的远程源客户端：每次扫描前经线协议的 host 代办向主进程要
 * 这个源的地址与凭据（主进程方法 webdavAccess，见 src/main/webdav），再建 WebDAV 客户端。
 *
 * 凭据只在主进程和引擎进程内存里，不落引擎的数据库、不进事件、不给渲染层。
 * 不缓存：用户改了密码，下一次扫描就用新的。
 */
import type { FromUtility, ToUtility } from '../../../shared/utility/protocol'
import {
  type DavAccess,
  type DavFetch,
  createDavClient,
} from '../../../shared/webdav/client'
import type { RemoteClients } from '../scanner/scan-library'

/** 主进程上的代办方法名。 */
export const WEBDAV_ACCESS_METHOD = 'webdavAccess'

/** 子进程这一侧的代办调用：发 host 消息，等对应 id 的 reply。 */
export interface HostCaller {
  call(method: string, args: unknown[]): Promise<unknown>
  /** 收到 reply 时交给它；不是代办的回复返回 false。 */
  settle(message: ToUtility): boolean
}

/** 建代办调用器；post 把消息发给主进程。 */
export function createHostCaller(
  post: (message: FromUtility) => void
): HostCaller {
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let nextId = 1
  return {
    call(method, args) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        post({ kind: 'host', id, method, args })
      })
    },
    settle(message) {
      if (message.kind !== 'reply') return false
      const waiting = pending.get(message.id)
      if (!waiting) return true
      pending.delete(message.id)
      if (message.ok) waiting.resolve(message.value)
      else waiting.reject(new Error(message.error.message))
      return true
    },
  }
}

/** 用主进程代办取凭据的远程客户端。 */
export function hostRemoteClients(
  host: HostCaller,
  fetch: DavFetch
): RemoteClients {
  return async sourceId => {
    const access = (await host.call(WEBDAV_ACCESS_METHOD, [
      sourceId,
    ])) as DavAccess | null
    if (!access) throw new Error('WebDAV 源不存在，可能已在设置里删除')
    return createDavClient(access, fetch)
  }
}
