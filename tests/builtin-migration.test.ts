import { describe, expect, it } from 'vitest'
import { planBuiltinMigration } from '../src/renderer/src/features/online/utils/builtin-migration'

const site = (host: string, tail = ''): { name: string; api: string } => ({
  name: host,
  api: `https://${host}/api.php/provide/vod${tail}`,
})

describe('planBuiltinMigration', () => {
  const base = {
    legacy: [site('a.com').api, site('b.com', '/').api, site('c.com').api],
    subscribed: [],
    custom: [],
  }

  it('旧内置站不在快照里的清掉，在快照里的改用快照写法并保留开关', () => {
    const next = planBuiltinMigration({
      ...base,
      selected: [site('a.com').api, site('b.com', '/').api],
      defaults: [site('www.b.com')],
    })
    expect(next).toEqual([site('www.b.com').api])
  })

  it('用户关掉的旧内置站（写法不同）迁移后仍是关闭', () => {
    const next = planBuiltinMigration({
      ...base,
      selected: [],
      defaults: [site('b.com')],
    })
    expect(next).toEqual([])
  })

  it('快照里的全新站默认启用', () => {
    const next = planBuiltinMigration({
      ...base,
      selected: [],
      defaults: [site('new.com')],
    })
    expect(next).toEqual([site('new.com').api])
  })

  it('订阅缓存里出现过的站保留用户的开关', () => {
    const next = planBuiltinMigration({
      ...base,
      selected: [],
      subscribed: [site('s.com')],
      defaults: [site('s.com')],
    })
    expect(next).toEqual([])
  })
})
