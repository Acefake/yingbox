import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadApi(
  account: () => Promise<unknown>
): Promise<typeof import('../src/renderer/src/features/netdisk/api')> {
  vi.resetModules()
  vi.stubGlobal('window', {
    api: {
      pan115: { account },
    },
  })
  return import('../src/renderer/src/features/netdisk/api')
}

describe('115 账号确认', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('第一次读取失败保持未确认，下次还能再查到登录', async () => {
    let calls = 0
    const api = await loadApi(async () => {
      calls += 1
      if (calls === 1) throw new Error('offline')
      return { loggedIn: true, userId: '1', userName: 'a' }
    })
    await api.refreshNetdiskAccount()
    expect(api.netdiskAccountKnown.value).toBe(false)
    expect(api.netdiskAccountFailed.value).toBe(true)
    expect(api.netdiskAccount.value).toBeNull()
    await api.ensureNetdiskAccount()
    expect(api.netdiskAccount.value).toEqual({
      loggedIn: true,
      userId: '1',
      userName: 'a',
    })
    expect(api.netdiskAccountKnown.value).toBe(true)
  })

  it('已经确认登录后，一次读取失败不清掉登录', async () => {
    let fail = false
    const api = await loadApi(async () => {
      if (fail) throw new Error('offline')
      return { loggedIn: true, userId: '1', userName: 'a' }
    })
    await api.refreshNetdiskAccount()
    fail = true
    await api.refreshNetdiskAccount()
    expect(api.netdiskAccount.value).toEqual({
      loggedIn: true,
      userId: '1',
      userName: 'a',
    })
  })
})
