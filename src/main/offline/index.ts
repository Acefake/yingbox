/**
 * 115 离线下载模块入口（只依赖模块宿主，桌面端主进程与独立服务共用）：把离线下载服务接到 115 服务、设置、
 * 媒体库变更通知与 offline 域。
 *
 * - 保存目录：网盘设置里的转存目标 `pan115.targetCid`（空为根目录）；
 * - 任务记录存 <dataDir>/offline-tasks.json（原子替换）；
 * - 每 3 分钟一轮：有没结束的任务时才向 115 查列表；完成后按 115 路径通知媒体库（映射 `library.notify.mountRoot`）。
 */
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { offline } from '../../shared/contract/offline'
import { atomicWrite } from '../file-operations'
import type { LibraryEngineClient } from '../library/client'
import type { ModuleHost } from '../module-host'
import type { Pan115Service } from '../pan115/service'
import { type OfflineService, createOfflineService } from './service'

/** 任务记录文件名（数据目录下） */
export const OFFLINE_FILE = 'offline-tasks.json'
const INTERVAL_MS = 3 * 60_000

/** 注册离线下载（registerPan115 之后调用一次）；返回服务供电影追踪用 */
export function registerOffline(
  host: ModuleHost,
  library: LibraryEngineClient,
  pan115: Pan115Service
): OfflineService {
  const file = join(host.dataDir, OFFLINE_FILE)
  const service = createOfflineService({
    pan: {
      loggedIn: async () => (await pan115.account()).loggedIn,
      add: (links, cid) => pan115.use(client => client.addOffline(links, cid)),
      list: page => pan115.use(client => client.offlineTasks(page)),
      dirPath: cid =>
        pan115.use(async client => {
          const listing = await client.dirs(cid)
          return listing.path.filter(d => d.cid !== '0').map(d => d.name)
        }),
    },
    folder: () => {
      const cid = host.setting('pan115.targetCid') || '0'
      return { cid, name: cid === '0' ? '' : host.setting('pan115.targetName') }
    },
    notify: async path => {
      const mountRoot = host.setting('library.notify.mountRoot')
      const changes = [{ action: 'create' as const, path }]
      await library.call(
        'notifyChanges',
        mountRoot ? { changes, mountRoot } : { changes }
      )
    },
    load: async () => JSON.parse(await fs.readFile(file, 'utf8')),
    save: state => atomicWrite(file, JSON.stringify(state)),
    now: () => Date.now(),
    emit: () => host.emit(offline, 'changed', undefined),
    log: message => console.info(`[offline] ${message}`),
  })

  host.schedule({
    name: 'offline',
    firstDelayMs: INTERVAL_MS,
    intervalMs: INTERVAL_MS,
    run: () => void service.tick().catch(() => {}),
  })
  host.implement(offline, {
    add: (_, links) => service.add(links),
    tasks: () => service.tasks(),
  })
  return service
}
