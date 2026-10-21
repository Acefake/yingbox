/**
 * 站点注册表：每个设置里的站点都有实现、没有多余实现；凭据现读；DMM 凭据格式。
 */
import { describe, expect, it } from 'vitest'
import { JAV_SITES } from '../../../src/shared/library/ipc'
import {
  createJavSites,
  parseDmmApiCredentials,
} from '../../../src/main/library/providers/jav/sites/registry'

describe('番号站点注册表', () => {
  it('JAV_SITES 与实现一一对应', () => {
    const impl = createJavSites().map(s => s.id)
    expect(new Set(impl).size).toBe(impl.length)
    expect([...impl].sort()).toEqual(JAV_SITES.map(s => s.id).sort())
  })

  it('凭据每次查询时现读：没令牌不查 ThePornDB / DMM API，填了就查', () => {
    const saved: { token?: string; dmm?: string } = {}
    const sites = createJavSites(() => ({
      theporndbToken: saved.token,
      dmmApi: parseDmmApiCredentials(saved.dmm),
    }))
    const tpdb = sites.find(s => s.id === 'theporndb')!
    const dmmApi = sites.find(s => s.id === 'dmm_api')!
    expect(tpdb.supports('censored')).toBe(false)
    expect(dmmApi.supports('censored')).toBe(false)
    saved.token = 'secret'
    saved.dmm = 'id:aff-990'
    expect(tpdb.supports('censored')).toBe(true)
    expect(dmmApi.supports('censored')).toBe(true)
  })

  it('DMM 凭据：API_ID:AFFILIATE_ID，缺一个就无效', () => {
    expect(parseDmmApiCredentials(' a : b-990 ')).toEqual({
      apiId: 'a',
      affiliateId: 'b-990',
    })
    expect(parseDmmApiCredentials('a')).toBeUndefined()
    expect(parseDmmApiCredentials(':b')).toBeUndefined()
    expect(parseDmmApiCredentials(undefined)).toBeUndefined()
  })
})
