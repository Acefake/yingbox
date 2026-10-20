/**
 * 启动引擎宿主并把引擎实现的域注册到 IPC。引擎按需启动：第一次调用时才 fork。
 */
import { app, utilityProcess } from 'electron'
import { join } from 'node:path'
import { broadcastChannel, implement } from '../rpc'
import { browserFetch } from '../browser-fetch'
import { online } from '../../shared/contract/online'
import { type EngineChild, EngineHost, forwardTo } from './host'

/** 注册引擎域（online）。 */
export function registerEngine(): EngineHost {
  const host = new EngineHost({
    fork: () =>
      utilityProcess.fork(
        join(__dirname, 'engine.js'),
        [app.getPath('userData')],
        { serviceName: 'yingbox-engine', stdio: 'inherit' }
      ) as unknown as EngineChild,
    broadcast: broadcastChannel,
    hostMethods: { browserFetch: (url, waitMs) => browserFetch(url, waitMs) },
  })
  implement(online, forwardTo(host, online))
  app.on('will-quit', () => host.shutdown())
  return host
}
