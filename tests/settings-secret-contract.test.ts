import { describe, expect, it } from 'vitest'

import { settings } from '../src/shared/contract/settings'

describe('settings 密钥契约', () => {
  it('readSecret 只放行渲染层可读的密钥（TMDB），Amane 令牌读不出', () => {
    const parse = settings.calls.readSecret.parse
    expect(parse(['scrape.tmdbToken'])).toEqual(['scrape.tmdbToken'])
    expect(() => parse(['amane.token'])).toThrow()
    expect(() => parse([42])).toThrow()
  })

  it('setSecret 只接受已登记的密钥键与字符串值', () => {
    const parse = settings.calls.setSecret.parse
    expect(parse(['amane.token', 'x'])).toEqual(['amane.token', 'x'])
    expect(() => parse(['app.theme', 'dark'])).toThrow()
    expect(() => parse(['scrape.tmdbToken', 1])).toThrow()
  })
})
