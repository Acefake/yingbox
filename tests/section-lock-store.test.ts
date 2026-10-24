import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { GRANT_TTL_MS, createGrantStore } from '../src/main/section-lock/rules'
import {
  type LockFile,
  createSectionLockStore,
} from '../src/main/section-lock/store'

/**
 * 板块密码锁的写入层：降低保护（取消锁定、放宽重新锁定、改 / 清密码）必须带主进程签发的
 * 一次性凭据，绕过设置界面直接调用写入接口也会被拒；增加保护不需要凭据。
 * 以及设置界面走验证流程、不再直接改设置项的接线。
 * test-affected: repo-wide（读源码断言接线）
 */

const root = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const FAST = { N: 1024, r: 8, p: 1 }

/** 内存落盘 + 可控时钟；初始已设密码 'pass1234'，锁着 AV */
async function setup(): Promise<{
  store: Awaited<ReturnType<typeof createSectionLockStore>>
  saved: () => LockFile | null
  tick: (ms: number) => void
}> {
  let time = 1_000_000
  let disk: LockFile | null = null
  const store = await createSectionLockStore({
    load: async () => disk,
    persist: async data => {
      disk = data
    },
    now: () => time,
    hashOptions: FAST,
  })
  await store.setPassword('', 'pass1234')
  await store.setConfig({ sections: ['AV'], relockMinutes: 5 }, '')
  return { store, saved: () => disk, tick: ms => (time += ms) }
}

describe('一次性凭据', () => {
  it('用一次作废、过期作废、伪造不通过', () => {
    let time = 0
    let seq = 0
    const grants = createGrantStore(
      () => `g${++seq}`,
      () => time
    )
    const first = grants.issue()
    expect(grants.consume(first)).toBe(true)
    expect(grants.consume(first)).toBe(false)
    expect(grants.consume('')).toBe(false)
    expect(grants.consume('forged')).toBe(false)
    const second = grants.issue()
    time += GRANT_TTL_MS
    expect(grants.consume(second)).toBe(false)
  })
})

describe('写入层校验（绕过界面直接调用）', () => {
  it('未验证时取消锁定被拒，配置不变', async () => {
    const { store, saved } = await setup()
    expect(await store.setConfig({ sections: [], relockMinutes: 5 }, '')).toBe(
      false
    )
    expect(
      await store.setConfig({ sections: [], relockMinutes: 5 }, 'forged')
    ).toBe(false)
    expect(store.status().sections).toEqual(['AV'])
    expect(saved()?.sections).toEqual(['AV'])
  })

  it('放宽重新锁定、清除 / 修改密码未验证时被拒', async () => {
    const { store } = await setup()
    expect(
      await store.setConfig({ sections: ['AV'], relockMinutes: 0 }, '')
    ).toBe(false)
    expect(await store.clearPassword('')).toBe(false)
    expect(await store.setPassword('', 'other1234')).toBe(false)
    expect(store.status()).toEqual({
      passwordSet: true,
      sections: ['AV'],
      relockMinutes: 5,
    })
    expect((await store.verify('pass1234')).ok).toBe(true)
  })

  it('密码验证后可取消锁定；凭据只能用一次', async () => {
    const { store } = await setup()
    const wrong = await store.verify('nope')
    expect(wrong).toEqual({ ok: false, retryAfterMs: 0, grant: '' })
    const { ok, grant } = await store.verify('pass1234')
    expect(ok).toBe(true)
    expect(grant).not.toBe('')
    expect(
      await store.setConfig({ sections: [], relockMinutes: 5 }, grant)
    ).toBe(true)
    expect(store.status().sections).toEqual([])
    await store.setConfig({ sections: ['AV'], relockMinutes: 5 }, '')
    expect(
      await store.setConfig({ sections: [], relockMinutes: 5 }, grant)
    ).toBe(false)
  })

  it('系统认证（Touch ID）签发的凭据同样有效；过期后无效', async () => {
    const { store, tick } = await setup()
    const late = store.grantForSystemAuth().grant
    tick(GRANT_TTL_MS)
    expect(await store.clearPassword(late)).toBe(false)
    const fresh = store.grantForSystemAuth().grant
    expect(await store.clearPassword(fresh)).toBe(true)
    expect(store.status()).toEqual({
      passwordSet: false,
      sections: [],
      relockMinutes: 5,
    })
  })

  it('验证后可修改密码，旧密码失效', async () => {
    const { store } = await setup()
    const { grant } = await store.verify('pass1234')
    expect(await store.setPassword(grant, 'next5678')).toBe(true)
    expect((await store.verify('pass1234')).ok).toBe(false)
    expect((await store.verify('next5678')).ok).toBe(true)
  })

  it('增加锁定、收紧重新锁定不需要验证', async () => {
    const { store } = await setup()
    expect(
      await store.setConfig({ sections: ['AV', 'Jav'], relockMinutes: 1 }, '')
    ).toBe(true)
    expect(store.status().sections).toEqual(['AV', 'Jav'])
  })

  it('落盘只有哈希；重启后读回配置，损坏的文件按未设密码处理', async () => {
    const { saved } = await setup()
    const file = saved()
    expect(JSON.stringify(file)).not.toContain('pass1234')
    const reopened = await createSectionLockStore({
      load: async () => file,
      persist: async () => {},
    })
    expect(reopened.status()).toEqual({
      passwordSet: true,
      sections: ['AV'],
      relockMinutes: 5,
    })
    const broken = await createSectionLockStore({
      load: async () => {
        throw new Error('ENOENT')
      },
      persist: async () => {},
    })
    expect(broken.status().passwordSet).toBe(false)
  })
})

describe('设置界面接线', () => {
  const settings = read(
    'src/renderer/src/features/section-lock/SectionLockSettings.vue'
  )
  const state = read('src/renderer/src/features/section-lock/lock-state.ts')

  it('改配置走 saveLockConfig（降低保护先验证）；不再直接写设置项', () => {
    expect(settings).not.toMatch(/setSetting|lock\.sections/)
    expect(settings).toMatch(/saveLockConfig\(/)
    expect(state).toMatch(
      /weakensLock\(current, next\)\)\s*\{\s*grant = await requestAuthorization/
    )
    expect(state).toMatch(/bridge\.setConfig\(config, grant\)/)
  })

  it('改 / 清密码先验证身份，把凭据交给主进程', () => {
    expect(settings).toMatch(/bridge\.setPassword\(grant, value\)/)
    expect(settings).toMatch(/bridge\.clearPassword\(grant\)/)
    expect(settings.match(/await authorize\(/g)).toHaveLength(2)
  })

  it('解锁界面把主进程签发的凭据交回请求方', () => {
    const gate = read(
      'src/renderer/src/features/section-lock/SectionLockGate.vue'
    )
    expect(gate).toMatch(/finish\(result\.grant\)/)
    expect(gate).not.toMatch(/finish\(true\)/)
  })
})
