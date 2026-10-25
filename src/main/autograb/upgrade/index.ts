/**
 * 主进程洗版模块入口：把洗版服务接到媒体库引擎、115、本地文件系统和 autograbUpgrade 域。
 *
 * 状态存 userData/autograb-upgrade.json（原子替换）。启动 5 分钟后跑第一轮，之后每小时一轮；
 * 一轮里真正向 115 发请求的只有到了每周搜索时间的文件，平时一轮只看本地挂载里新文件到了没有。
 */
import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

import { autograbUpgrade } from '../../../shared/contract/autograb-upgrade'
import { atomicWrite } from '../../file-operations'
import type { LibraryEngineClient } from '../../library/host'
import { emit, implement } from '../../rpc'
import { settingsStore } from '../../settings'
import type { Gate } from '../gate'
import type { PanAdapter } from './pan-adapter'
import { createUpgradeService } from './service'

const FIRST_DELAY_MS = 5 * 60_000
const INTERVAL_MS = 60 * 60_000

/** 注册洗版（registerAutograb 之后调用一次） */
export function registerAutograbUpgrade(
  library: LibraryEngineClient,
  pan: PanAdapter,
  gate: () => Promise<Gate>
): void {
  const store = settingsStore()
  const file = join(app.getPath('userData'), 'autograb-upgrade.json')
  const service = createUpgradeService({
    library: {
      listLibraries: () => library.call('listLibraries', undefined),
      query: query => library.call('query', query),
      getItem: itemId => library.call('getItem', { itemId }),
    },
    gate,
    pan,
    mountRoot: () => store.get('library.notify.mountRoot'),
    fileExists: path =>
      fs.stat(path).then(
        s => s.isFile(),
        () => false
      ),
    removeFile: path => fs.unlink(path),
    notify: async paths => {
      await library.call('notifyChanges', {
        changes: paths.map(path => ({ action: 'create' as const, path })),
      })
    },
    load: async () => {
      try {
        return JSON.parse(await fs.readFile(file, 'utf8'))
      } catch {
        return null
      }
    },
    save: state => atomicWrite(file, JSON.stringify(state)),
    now: () => Date.now(),
    emit: () => emit(autograbUpgrade, 'changed', undefined),
    log: message => console.info(`[autograb-upgrade] ${message}`),
  })

  const run = (force = false): void =>
    void pan.refresh().then(() => service.tick(force))
  setTimeout(() => {
    run()
    setInterval(run, INTERVAL_MS).unref()
  }, FIRST_DELAY_MS).unref()

  implement(autograbUpgrade, {
    overview: async () => {
      await pan.refresh()
      return service.overview()
    },
    setOptions: (_, patch) => service.setOptions(patch),
    replace: (_, key, index, cid) => service.replace(key, index, cid),
    ignore: (_, key) => service.ignore(key),
    retry: (_, key) => service.retry(key),
    deleteOld: (_, key) => service.deleteOld(key),
    runNow: async () => run(true),
  })
}
