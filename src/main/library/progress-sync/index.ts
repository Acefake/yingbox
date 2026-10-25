/**
 * 观看进度同步接到 Electron：读设置 library.progressServer / progressServerToken，
 * 启动时、每 3 分钟、改了地址或令牌、渲染层点「立即同步」时各跑一轮，注册 progressSync 域。
 * 游标存在 userData/library/progress-sync.json。逻辑在 syncer.ts（合并顺序）与 remote-peer.ts（HTTP）。
 */
import { app } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { progressSync } from '../../../shared/contract/progress-sync'
import { atomicWrite } from '../../file-operations'
import { emit, implement } from '../../rpc'
import { onSecretSaved, onSettingChanged, settingsStore } from '../../settings'
import type { LibraryEngineClient } from '../host'
import { createRemotePeer, parseServerUrl } from './remote-peer'
import { type SyncCursor, createProgressSyncer } from './syncer'

/** 定时同步的间隔。 */
const INTERVAL_MS = 3 * 60_000
const TOKEN_KEY = 'library.progressServerToken'

const cursorPath = (): string =>
  join(app.getPath('userData'), 'library', 'progress-sync.json')

function readCursor(): SyncCursor | null {
  try {
    const raw = JSON.parse(readFileSync(cursorPath(), 'utf8')) as SyncCursor
    return typeof raw.server === 'string' && Number.isFinite(raw.lastSync)
      ? raw
      : null
  } catch {
    return null
  }
}

/** 注册同步；须在 initSettings 与 registerLibraryIpc 之后调用。 */
export function registerProgressSync(client: LibraryEngineClient): void {
  const store = settingsStore()
  const syncer = createProgressSyncer({
    local: {
      export: since => client.call('progress.export', { since }),
      import: (entries, preferIncoming) =>
        client.call('progress.import', { entries, preferIncoming }),
    },
    remote: () => {
      const server = parseServerUrl(store.get('library.progressServer'))
      return server
        ? {
            server,
            peer: createRemotePeer({
              server,
              token: store.getSecret(TOKEN_KEY),
            }),
          }
        : null
    },
    readCursor,
    writeCursor: cursor =>
      void atomicWrite(cursorPath(), JSON.stringify(cursor)).catch(error =>
        console.warn('[progress-sync] 游标写入失败', (error as Error).message)
      ),
    onStatus: status => emit(progressSync, 'changed', status),
    onApplied: itemIds => emit(progressSync, 'applied', { itemIds }),
  })
  implement(progressSync, {
    status: () => syncer.status(),
    syncNow: () => syncer.sync(),
  })
  const run = (): void => {
    void syncer.sync().then(status => {
      if (status.error) console.warn('[progress-sync]', status.error)
    })
  }
  onSettingChanged(change => {
    if (change.key === 'library.progressServer') run()
  })
  onSecretSaved(key => {
    if (key === TOKEN_KEY) run()
  })
  const timer = setInterval(run, INTERVAL_MS)
  app.on('will-quit', () => clearInterval(timer))
  run()
}
