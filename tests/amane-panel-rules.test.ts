import { describe, expect, it } from 'vitest'
import {
  allDecided,
  cellText,
  csvCell,
  csvFilename,
  followsBottom,
  isFirstTurn,
  pollDelay,
  toCsv,
} from '@/features/amane/utils/agent'
import {
  activeDictKey,
  asArray,
  asObject,
  canAddKey,
  enumValue,
  isHiddenField,
  isInlineField,
  isSecretPath,
  moveItem,
  numberValue,
  optionLabel,
  replaceAt,
  toggleItem,
  withoutKey,
} from '@/features/amane/config/config-field'

describe('智能体面板', () => {
  it('单元格：字符串原样，其它转 JSON，undefined 为空', () => {
    expect(cellText('a')).toBe('a')
    expect(cellText({ a: 1 })).toBe('{\n  "a": 1\n}')
    expect(cellText(undefined)).toBe('')
  })
  it('CSV：引号转义、防公式注入、带 BOM、CRLF', () => {
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"')
    expect(csvCell('-1')).toBe('"\'-1"')
    expect(toCsv(['x', 'y'], [[1, 'b']])).toBe('\ufeff"x","y"\r\n"1","b"')
    expect(csvFilename(7, 200)).toBe('amane-query-7-page-3.csv')
  })
  it('离底部不到 100px 才跟随滚动', () => {
    expect(followsBottom(null)).toBe(true)
    expect(
      followsBottom({ scrollHeight: 1000, scrollTop: 401, clientHeight: 500 })
    ).toBe(true)
    expect(
      followsBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 500 })
    ).toBe(false)
  })
  it('轮询间隔、审批齐全、首轮判定', () => {
    expect([pollDelay(true), pollDelay(false)]).toEqual([1000, 6000])
    expect(allDecided([{ id: 'a' }, { id: 'b' }], { a: true })).toBe(false)
    expect(allDecided([{ id: 'a' }], { a: false })).toBe(true)
    expect(isFirstTurn([{ type: 'text_delta' }])).toBe(true)
    expect(isFirstTurn([{ type: 'user_message' }])).toBe(false)
  })
})

describe('配置字段', () => {
  it('密钥字段按路径段识别', () => {
    expect(isSecretPath('scraping.site_config.$.cookie.$')).toBe(true)
    expect(isSecretPath('agent.api_key')).toBe(true)
    expect(isSecretPath('agent.api_keys')).toBe(false)
  })
  it('隐藏：x-hidden，或字典键不在可见列表', () => {
    expect(isHiddenField({ 'x-hidden': true })).toBe(true)
    expect(isHiddenField({ 'x-visible-keys': ['a'] }, 'b')).toBe(true)
    expect(isHiddenField({ 'x-visible-keys': ['a'] }, 'a')).toBe(false)
    expect(isHiddenField({ 'x-visible-keys': ['a'] })).toBe(false)
  })
  it('单行布局：单值字段且不是 bare / 长文本', () => {
    expect(isInlineField({ type: 'string' })).toBe(true)
    expect(isInlineField({ enum: ['a'] })).toBe(true)
    expect(isInlineField({ type: 'string' }, true)).toBe(false)
    expect(isInlineField({ type: 'string', 'x-long': true })).toBe(false)
    expect(isInlineField({ type: 'array' })).toBe(false)
  })
  it('选项文字：x-show-names 优先于原值', () => {
    expect(optionLabel('zz.none', 'v', { 'x-show-names': ['名字'] }, 0)).toBe(
      '名字'
    )
    expect(optionLabel('zz.none', 'v', {}, 0)).toBe('v')
  })
  it('值读取：对象 / 数组以外给空', () => {
    expect(asObject([1])).toEqual({})
    expect(asObject(null)).toEqual({})
    expect(asArray('x')).toEqual([])
  })
  it('字典键：拒绝空、原型链关键字与重复', () => {
    expect(canAddKey('a', {})).toBe(true)
    expect(canAddKey('', {})).toBe(false)
    expect(canAddKey('__proto__', {})).toBe(false)
    expect(canAddKey('a', { a: 1 })).toBe(false)
    expect(withoutKey({ a: 1, b: 2 }, 'a')).toEqual({ b: 2 })
    expect(activeDictKey({ a: 1, b: 2 }, 'b')).toBe('b')
    expect(activeDictKey({ a: 1 }, 'gone')).toBe('a')
    expect(activeDictKey({}, 'x')).toBe('')
  })
  it('数组：替换、移动（越界不动）、多选切换', () => {
    expect(replaceAt([1, 2], 1, 3)).toEqual([1, 3])
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1])
    expect(moveItem([1, 2], 0, 2)).toBeNull()
    expect(moveItem([1, 2], -1, 0)).toBeNull()
    expect(toggleItem([1, 2], 2)).toEqual([1])
    expect(toggleItem([1], 2)).toEqual([1, 2])
  })
  it('输入换算：枚举还原原始类型，可空选空为 null；数字清空为 null、非法不更新', () => {
    expect(enumValue({ enum: [1, 2] }, '2')).toBe(2)
    expect(enumValue({ enum: [1], nullable: true }, '')).toBeNull()
    expect(enumValue({ enum: [1] }, '')).toBe('')
    expect(numberValue('', NaN)).toBeNull()
    expect(numberValue('3', 3)).toBe(3)
    expect(numberValue('e', NaN)).toBeUndefined()
  })
})
