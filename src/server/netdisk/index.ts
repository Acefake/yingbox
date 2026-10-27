/**
 * 独立服务里的网盘类模块：pan115（PanSou / Torznab 搜索、扫码登录、转存）+ 追更（剧集、洗版、电影上线追踪）+ 库外发现
 * + 115 离线下载。
 *
 * 与桌面端共用同一套模块入口（src/main/pan115、autograb、discover），只换模块宿主：
 * | 桌面端（Electron）                         | 独立服务（本目录）                                   |
 * | ------------------------------------------ | ---------------------------------------------------- |
 * | 分区 persist:pan115 的 session.fetch        | Node fetch + 持久化 Cookie 罐（node-transport.ts）    |
 * | safeStorage 密钥 pan115.session / torznab    | secrets.json 的同名键（0600；Torznab 可用环境变量兜底）|
 * | settings.json                               | server-settings.json（settings-store，0600）         |
 * | ipcMain / webContents.send                  | HTTP RPC / SSE（domains/）                           |
 * | userData/autograb*.json、offline-tasks.json | <dataDir> 下同名文件                                  |
 * | setTimeout / setInterval                    | 同上，但只在持有调度租约的实例上执行（scheduler.ts）  |
 * 转存后的入库通知走同进程 LibraryService.notifyChanges（与桌面端经引擎调用同一个方法）。
 * 入库推送（系统通知 / Bark / Telegram）只在桌面端，服务端不发。
 */
import { join } from 'node:path'

import { registerAutograb } from '../../main/autograb'
import { registerAutograbMovies } from '../../main/autograb/movies'
import { createPanAdapter } from '../../main/autograb/upgrade/pan-adapter'
import { registerAutograbUpgrade } from '../../main/autograb/upgrade'
import { registerDiscover } from '../../main/discover'
import type { LibraryEngineClient } from '../../main/library/client'
import { handleRpc } from '../../main/library/engine/rpc'
import type { LibraryService } from '../../main/library/engine/service'
import type { ModuleHost } from '../../main/module-host'
import { registerOffline } from '../../main/offline'
import { implementPan115 } from '../../main/pan115/domain'
import type { FetchLike } from '../../main/pan115/http'
import {
  type Pan115Service,
  createPan115Service,
} from '../../main/pan115/service'
import { parseSession, serializeSession } from '../../main/pan115/session-codec'
import {
  TORZNAB_SECRET_KEY,
  parseTorznabSecret,
  serializeTorznabSecret,
  torznabFromEnv,
} from '../../main/pan115/torznab-secret'
import {
  defaultFolder,
  readTargetSettings,
} from '../../shared/netdisk/target-folder'
import { DomainRegistry } from '../domains/registry'
import { registerDomainRoutes } from '../domains/routes'
import type { Router } from '../http/router'
import { type FileSecretStore, SECRET_KEYS } from '../secrets'
import type { ServerSettingsStore } from '../settings-store'
import { loadNetdiskConfig } from './config'
import { CookieJar } from './cookie-jar'
import { SchedulerLease } from './lease'
import { createNodeTransport } from './node-transport'
import { type LeasedScheduler, createLeasedScheduler } from './scheduler'

/** 115 会话在 secrets.json 里的键（与桌面端 safeStorage 密钥同名） */
export const PAN115_SESSION_KEY = 'pan115.session'

/** 落盘文件名（都在数据目录下） */
export const NETDISK_FILES = {
  cookies: 'pan115-cookies.json',
  settings: 'server-settings.json',
  lease: 'scheduler.lock',
} as const

/** 依赖 */
export interface NetdiskOptions {
  dataDir: string
  env: NodeJS.ProcessEnv
  secrets: FileSecretStore
  service: LibraryService
  router: Router
  /** 服务端设置存储（app.ts 创建，网页端设置路由也由它登记） */
  settings: ServerSettingsStore
  log(message: string): void
  /** 115 与 PanSou / Torznab 的底层 fetch（缺省全局 fetch）；测试注入 */
  fetch?: FetchLike
}

/** 加载好的模块 */
export interface Netdisk {
  registry: DomainRegistry
  pan115: Pan115Service
  scheduler: LeasedScheduler
  settings: ServerSettingsStore
  close(): void
}

/** 同进程 LibraryService 的调用口（参数校验与 HTTP RPC 相同）；失败时抛出 */
export function libraryClient(service: LibraryService): LibraryEngineClient {
  return {
    async call(method, params) {
      const reply = await handleRpc(service, { method, params })
      if (!reply.ok) throw new Error(reply.error.message)
      return reply.result as never
    },
  }
}

/** 加载网盘类模块并登记路由；YINGBOX_NETDISK=off 时返回 null */
export function startNetdisk(options: NetdiskOptions): Netdisk | null {
  const { dataDir, env, secrets, log } = options
  const config = loadNetdiskConfig(env)
  if (!config.enabled) {
    log('网盘 / 追更：已关闭（YINGBOX_NETDISK=off）')
    return null
  }
  const send: FetchLike = options.fetch ?? ((url, init) => fetch(url, init))
  const { settings } = options
  const registry = new DomainRegistry()
  const scheduler = createLeasedScheduler({
    lease: new SchedulerLease({ file: join(dataDir, NETDISK_FILES.lease) }),
    enabled: config.autograb,
    log: message => log(`[autograb] ${message}`),
  })
  registerDomainRoutes(options.router, registry)

  const host: ModuleHost = {
    dataDir,
    setting: key => settings.get(key),
    tmdbToken: () =>
      secrets.get(SECRET_KEYS.tmdbToken) ||
      env.YINGBOX_TMDB_TOKEN?.trim() ||
      env.VITE_TMDB_ACCESS_TOKEN?.trim() ||
      '',
    implement: (domain, handlers) => registry.implement(domain, handlers),
    emit: (domain, event, payload) => registry.emit(domain, event, payload),
    schedule: task => scheduler.schedule(task),
  }

  const transport = createNodeTransport({
    jar: CookieJar.open(join(dataDir, NETDISK_FILES.cookies)),
    fetch: send,
  })
  const pan115 = createPan115Service({
    transport,
    lanFetch: send,
    settings: {
      pansouUrl: () => settings.get('pan115.pansouUrl'),
      defaultCid: () =>
        defaultFolder(
          'movie',
          readTargetSettings(key => settings.get(key))
        ).cid,
    },
    session: {
      read: () => parseSession(secrets.get(PAN115_SESSION_KEY) ?? ''),
      write: async value =>
        secrets.set(PAN115_SESSION_KEY, serializeSession(value) || null),
    },
    torznab: {
      read: () =>
        parseTorznabSecret(secrets.get(TORZNAB_SECRET_KEY)) ??
        torznabFromEnv(env),
      write: async value =>
        secrets.set(TORZNAB_SECRET_KEY, serializeTorznabSecret(value) || null),
    },
  })
  void pan115.restore().catch(() => {})
  implementPan115(host, pan115)

  const library = libraryClient(options.service)
  const autograb = registerAutograb(host, library, pan115)
  const pan = createPanAdapter(pan115, () => settings.get('pan115.pansouUrl'))
  const gate = (): ReturnType<typeof autograb.gate> => autograb.gate()
  registerAutograbUpgrade(host, library, pan, gate)
  registerAutograbMovies(host, library, pan, gate)
  registerDiscover(host, library, pan115, autograb)
  registerOffline(host, library, pan115)
  log(
    `网盘 / 追更：已启用（${config.autograb ? '本实例跑定时任务' : 'YINGBOX_AUTOGRAB=off，本实例不跑定时任务'}）`
  )

  return {
    registry,
    pan115,
    scheduler,
    settings,
    close: () => scheduler.close(),
  }
}
