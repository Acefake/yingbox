/**
 * 独立服务托管在线引擎：child_process.fork 起 src/engine/node.ts（构建产物 out/server/engine.js），
 * 生命周期与线协议直接用桌面端的 EngineHost / UtilityHost（按需启动、崩溃重启、空闲退出、关停超时 kill），
 * 这里只换掉 fork 和三项宿主能力：
 * - downloadDir：配置的下载目录（YINGBOX_DOWNLOAD_DIR）；
 * - tmdbToken：服务密钥文件里的 TMDB 令牌（网页端媒体库设置里保存的那个），再退回环境变量；
 * - browserFetch：可选的系统 Chromium（browser-fetch.ts），没配置时返回空串让引擎降级。
 * 引擎事件按通道广播给订阅方（SSE）。
 */
import { type ChildProcess, fork } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { EngineHost } from '../../main/engine/host'
import { resumePendingDownloads } from '../../main/engine/pending-downloads'
import type { UtilityChild } from '../../main/utility/host'
import { channelOf } from '../../shared/contract/define'
import { download } from '../../shared/contract/download'
import type { EngineEventMessage } from '../../shared/engine-http'
import type { FromUtility } from '../../shared/utility/protocol'
import type { NodeBrowserFetch } from './browser-fetch'
import type { OnlineConfig } from './config'

/** 服务端引擎。 */
export interface ServerEngine {
  /** 转发一次调用（参数已按契约解析） */
  invoke(channel: string, args: unknown[]): Promise<unknown>
  /** 订阅引擎事件；返回退订函数 */
  subscribe(listener: (event: EngineEventMessage) => void): () => void
  shutdown(): Promise<void>
}

/** 依赖。 */
export interface ServerEngineDeps {
  config: OnlineConfig
  browser: NodeBrowserFetch
  /** 当前 TMDB 令牌（未配置为空串） */
  tmdbToken: () => string
  log: (message: string) => void
  /** fork 子进程（测试注入），缺省按 engineEntry() fork */
  fork?: () => UtilityChild
}

/** 引擎入口：构建产物在服务旁边（out/server/engine.js），直接跑源码（tsx）时用 src/engine/node.ts。 */
export function engineEntry(dir = __dirname): string {
  const candidates = [
    join(dir, 'engine.js'),
    join(dir, '..', 'engine.js'),
    resolve(dir, '../../engine/node.ts'),
  ]
  return candidates.find(file => existsSync(file)) ?? candidates[0]
}

/** 把 ChildProcess 包成 UtilityHost 要的形状。 */
export function wrapChild(child: ChildProcess): UtilityChild {
  return {
    postMessage(message) {
      if (child.connected) child.send(message)
    },
    on(event: 'message' | 'exit', listener: (value: never) => void) {
      if (event === 'exit')
        child.on('exit', code => listener((code ?? 1) as never))
      else
        child.on('message', message =>
          listener(message as FromUtility as never)
        )
    },
    kill: () => child.kill(),
    stderr: child.stderr,
  } as UtilityChild
}

/** fork 引擎子进程：结构化克隆传消息（与 utilityProcess 一致），stderr 交给崩溃守卫。 */
export function forkEngine(entry: string, dataDir: string): UtilityChild {
  return wrapChild(
    fork(entry, [dataDir], {
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'pipe', 'ipc'],
    })
  )
}

/** 创建服务端引擎；队列里有没下完的任务时立即拉起续传。 */
export function createServerEngine(deps: ServerEngineDeps): ServerEngine {
  const { config, browser, log } = deps
  mkdirSync(config.engineDir, { recursive: true })
  const listeners = new Set<(event: EngineEventMessage) => void>()
  const host = new EngineHost({
    fork: deps.fork ?? (() => forkEngine(engineEntry(), config.engineDir)),
    idleMs: config.idleMs,
    broadcast: (channel, payload) => {
      for (const listener of listeners) listener({ channel, payload })
    },
    onReady: ms => log(`在线引擎就绪（${ms} ms）`),
    onBlocked: reason => log(`在线引擎停止重启：${reason}`),
    hostMethods: {
      browserFetch: url => browser.browserFetch(url),
      resetBrowserFetch: async target => browser.resetBrowserFetch(target),
      downloadDir: async () => {
        mkdirSync(config.downloadDir, { recursive: true })
        return config.downloadDir
      },
      tmdbToken: async () => deps.tmdbToken(),
    },
  })
  void resumePendingDownloads(
    join(config.engineDir, 'downloads', 'queue.json'),
    () => host.invoke(channelOf(download.name, 'list'), [])
  )
  return {
    invoke: (channel, args) => host.invoke(channel, args),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async shutdown() {
      await host.shutdown()
      await browser.close()
    },
  }
}
