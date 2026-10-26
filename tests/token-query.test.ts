import { describe, expect, it } from 'vitest'

import { tokenCandidates } from '../src/shared/net/token-query'

describe('地址栏令牌 tokenCandidates', () => {
  it('没有令牌时为空', () => {
    expect(tokenCandidates('')).toEqual([])
    expect(tokenCandidates('?a=1&tokenx=2')).toEqual([])
    expect(tokenCandidates('?token=')).toEqual([])
  })

  it('编码好的令牌按原样解出', () => {
    const token = 'ab+c/d=='
    expect(tokenCandidates(`?token=${encodeURIComponent(token)}`)).toEqual([
      token,
    ])
  })

  it('照文档手拼、+ 没编码：先给表单读法，再给 + 原样的读法', () => {
    expect(tokenCandidates('?x=1&token=ab+c/d==')).toEqual([
      'ab c/d==',
      'ab+c/d==',
    ])
  })

  it('坏的百分号编码不抛错', () => {
    expect(tokenCandidates('?token=%E0%A4%A')).toEqual([])
  })

  it('hex 令牌不受影响', () => {
    expect(tokenCandidates('token=0123abcd')).toEqual(['0123abcd'])
  })
})
