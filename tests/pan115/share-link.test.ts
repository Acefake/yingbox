/**
 * 115 分享链接解析：域名、分享码、提取码的来源优先级与边界。
 */
import { describe, expect, it } from 'vitest'

import { parseShareLink } from '../../src/main/pan115/share-link'

describe('parseShareLink', () => {
  it('115.com / 115cdn.com / anxia.com，提取码取自 password 参数', () => {
    expect(parseShareLink('https://115.com/s/swh3abc12?password=x1y2')).toEqual(
      { shareCode: 'swh3abc12', receiveCode: 'x1y2' }
    )
    expect(
      parseShareLink('https://115cdn.com/s/swh3abc12?password=x1y2#')
    ).toEqual({ shareCode: 'swh3abc12', receiveCode: 'x1y2' })
    expect(
      parseShareLink('http://anxia.com/s/sw0001?foo=1&password=ab12')
    ).toEqual({ shareCode: 'sw0001', receiveCode: 'ab12' })
  })

  it('文字里的「提取码 / 访问码」与单独给的密码', () => {
    expect(parseShareLink('链接：115.com/s/swq1w2e3 提取码：zx98')).toEqual({
      shareCode: 'swq1w2e3',
      receiveCode: 'zx98',
    })
    expect(parseShareLink('https://115.com/s/swq1w2e3#访问码=ab34')).toEqual({
      shareCode: 'swq1w2e3',
      receiveCode: 'ab34',
    })
    expect(parseShareLink('https://115.com/s/swq1w2e3', ' kk11 ')).toEqual({
      shareCode: 'swq1w2e3',
      receiveCode: 'kk11',
    })
  })

  it('链接里的提取码优先于单独给的；没有提取码时为空串', () => {
    expect(
      parseShareLink('https://115.com/s/sw1?password=aaaa', 'bbbb')
    ).toEqual({ shareCode: 'sw1', receiveCode: 'aaaa' })
    expect(parseShareLink('https://115.com/s/sw1')).toEqual({
      shareCode: 'sw1',
      receiveCode: '',
    })
  })

  it('提取码必须恰好 4 位：更长的串不截取前 4 位', () => {
    // 文字里「密码：abcdef」不是 115 的提取码，不能当成 abcd
    expect(parseShareLink('115.com/s/sw2 密码：abcdef')).toEqual({
      shareCode: 'sw2',
      receiveCode: '',
    })
    expect(parseShareLink('https://115.com/s/sw2?password=abcde')).toEqual({
      shareCode: 'sw2',
      receiveCode: '',
    })
    // 4 位后面紧跟中文或标点仍然算
    expect(parseShareLink('115.com/s/sw2 提取码:ab12，速存')).toEqual({
      shareCode: 'sw2',
      receiveCode: 'ab12',
    })
    expect(parseShareLink('https://115.com/s/sw2?password=ab12&x=1')).toEqual({
      shareCode: 'sw2',
      receiveCode: 'ab12',
    })
  })

  it('单独给的密码也要 4 位字母数字，否则当作没有', () => {
    expect(parseShareLink('https://115.com/s/sw3', 'abcdef')).toEqual({
      shareCode: 'sw3',
      receiveCode: '',
    })
    expect(parseShareLink('https://115.com/s/sw3', 'a b1')).toEqual({
      shareCode: 'sw3',
      receiveCode: '',
    })
    expect(parseShareLink('https://115.com/s/sw3', 'AB12')).toEqual({
      shareCode: 'sw3',
      receiveCode: 'AB12',
    })
  })

  it('不是 115 分享链接时返回 null', () => {
    expect(parseShareLink('https://pan.quark.cn/s/abcd')).toBeNull()
    expect(parseShareLink('https://evil115.com/s/abcd')).toBeNull()
    expect(parseShareLink('')).toBeNull()
  })
})
