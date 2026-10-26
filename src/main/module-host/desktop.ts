/**
 * 桌面端的模块宿主：契约走 ipcMain（rpc/index.ts）、设置与密钥读 settings.json / safeStorage、数据在 userData。
 */
import { app } from 'electron'

import { emit, implement } from '../rpc'
import { settingsStore } from '../settings'
import { TMDB_SECRET, effectiveTmdbToken } from '../tmdb'
import { type ModuleHost, intervalSchedule } from '.'

/** 建桌面端宿主（app ready、initSettings 之后调用） */
export function desktopModuleHost(): ModuleHost {
  const store = settingsStore()
  return {
    dataDir: app.getPath('userData'),
    setting: key => store.get(key),
    tmdbToken: () => effectiveTmdbToken(store.getSecret(TMDB_SECRET)),
    implement: (domain, handlers) => implement(domain, handlers),
    emit: (domain, event, payload) => emit(domain, event, payload),
    schedule: intervalSchedule,
  }
}
