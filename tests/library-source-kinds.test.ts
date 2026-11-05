/**
 * 媒体库「添加来源」：按运行环境得出可用来源与分组。
 */
import { describe, expect, it } from 'vitest'

import {
  availableSourceKinds,
  groupSourceKinds,
} from '../src/renderer/src/features/library/sources/source-kinds'

const kinds = (env: Parameters<typeof availableSourceKinds>[0]): string[] =>
  availableSourceKinds(env).map(spec => spec.kind)

describe('availableSourceKinds', () => {
  it('桌面端：本地 + 115 + WebDAV', () => {
    expect(kinds({ local: true, pan115: true, webdav: true })).toEqual([
      'local',
      'pan115',
      'webdav',
    ])
  })

  it('网页 / NAS 端：本地 + 115', () => {
    expect(kinds({ local: true, pan115: true, webdav: false })).toEqual([
      'local',
      'pan115',
    ])
  })

  it('本地不可用时不列出本地', () => {
    expect(kinds({ local: false, pan115: false, webdav: true })).toEqual([
      'webdav',
    ])
  })
})

describe('groupSourceKinds', () => {
  it('按分组归并并跳过空分组', () => {
    const groups = groupSourceKinds(
      availableSourceKinds({ local: true, pan115: false, webdav: true })
    )
    expect(groups.map(g => g.name)).toEqual(['本机', '网络共享'])
    expect(groups[0].items.map(i => i.kind)).toEqual(['local'])
  })
})
