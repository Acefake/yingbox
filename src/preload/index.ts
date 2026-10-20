/**
 * 通用 preload：按 IPC 契约生成 `window.api`。
 *
 * 调用 → ipcRenderer.invoke('<域>:<键>')，同步调用 → sendSync；事件 → on<Key>(cb) / off<Key>()。
 * sandboxed preload 只能 require('electron')，契约是纯 TS，会被打包进本文件。
 */
import { contextBridge, ipcRenderer } from 'electron'
import { contract } from '../shared/contract'
import {
  type Domain,
  type SyncReply,
  channelOf,
  listenerNames,
} from '../shared/contract/define'
import { createLibraryBridge } from './library-bridge'

/** 为一个域生成渲染层代理 */
function bridge(domain: Domain): Record<string, unknown> {
  const api: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(domain.calls)) {
    const channel = channelOf(domain.name, key)
    api[key] =
      def.kind === 'sync'
        ? (...args: unknown[]): unknown => {
            const reply: SyncReply = ipcRenderer.sendSync(channel, ...args)
            if (!reply.ok) throw new Error(reply.error)
            return reply.value
          }
        : (...args: unknown[]): Promise<unknown> =>
            ipcRenderer.invoke(channel, ...args)
  }
  for (const key of Object.keys(domain.events)) {
    const channel = channelOf(domain.name, key)
    const { on, off } = listenerNames(key)
    api[on] = (cb: (payload: unknown) => void): void => {
      ipcRenderer.on(channel, (_event, payload) => cb(payload))
    }
    api[off] = (): void => {
      ipcRenderer.removeAllListeners(channel)
    }
  }
  return api
}

contextBridge.exposeInMainWorld('api', {
  ...Object.fromEntries(
    Object.values(contract).map(domain => [domain.name, bridge(domain)])
  ),
  // 媒体库引擎由影视项目维护，自带 bridge（调用转发到 utilityProcess，事件经 MessagePort 直达）
  library: createLibraryBridge(ipcRenderer),
})
