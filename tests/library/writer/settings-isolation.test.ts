import { expect, it } from 'vitest'
import { openLibraryDb } from '../../../src/main/library/db/database'
import { SettingsStore } from '../../../src/main/library/providers/settings-store'
import { WriterSettingsStore } from '../../../src/main/library/writer/writer-settings'
import { autoFollowups } from '../../../src/main/library/writer/auto-rules'
import {
  DEFAULT_LIBRARY_AUTOMATION,
  DEFAULT_WRITER_SETTINGS,
} from '../../../src/shared/library/ipc'

it('旧配置复制为番号初始值后，两边模板、整理和写出选项独立持久化', () => {
  const db = openLibraryDb(':memory:')
  try {
    const raw = new SettingsStore(db)
    const old = structuredClone(DEFAULT_WRITER_SETTINGS)
    old.organize.movieTemplate = 'old/{title}.{ext}'
    raw.set('writer.settings', JSON.stringify(old), 1)
    const store = new WriterSettingsStore(raw)
    const movie = store.get()
    movie.organize.movieTemplate = 'movies/{title}.{ext}'
    movie.organize.enabled = true
    store.set(movie, 2)
    expect(store.get('jav').organize.movieTemplate).toBe(
      old.organize.movieTemplate
    )
    const jav = store.get('jav')
    jav.organize.movieTemplate = 'jav/{title}.{ext}'
    jav.nfo.enabled = false
    jav.artwork.poster = false
    store.set(jav, 3, 'jav')
    const reopened = new WriterSettingsStore(new SettingsStore(db))
    expect(reopened.get()).toEqual(movie)
    expect(reopened.get('jav')).toEqual(jav)
  } finally {
    db.close()
  }
})

it('自动整理和自动写出按所属库的独立设置分组', () => {
  const movie = structuredClone(DEFAULT_WRITER_SETTINGS)
  const jav = structuredClone(DEFAULT_WRITER_SETTINGS)
  jav.organize.enabled = true
  jav.autoWriteAfterIdentify = true
  const followups = autoFollowups([1, 2], movie, {
    libraryOf: id => id,
    automationOf: () => ({ ...DEFAULT_LIBRARY_AUTOMATION, organize: true }),
    settingsOf: id => (id === 2 ? jav : movie),
  })
  expect(followups).toMatchObject([
    {
      type: 'writer-auto-organize',
      payload: { itemIds: [2], writeAfter: [2] },
    },
  ])
})
