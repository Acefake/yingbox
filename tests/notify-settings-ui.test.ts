/**
 * 「新入库」设置分区的纯规则：Bark 地址校验、密钥占位、每日上限选项。
 */
import { describe, expect, it } from 'vitest'
import {
  dailyLimitOptions,
  secretPlaceholder,
  validBarkServer,
} from '../src/renderer/src/features/notify/notify-ui-rules'

describe('notify-ui-rules', () => {
  it('Bark 地址只认 http / https', () => {
    expect(validBarkServer('https://api.day.app')).toBe(true)
    expect(validBarkServer('http://192.168.1.5:8080')).toBe(true)
    expect(validBarkServer('api.day.app')).toBe(false)
    expect(validBarkServer('javascript:alert(1)')).toBe(false)
  })

  it('已配置的密钥不回显', () => {
    expect(secretPlaceholder(true, 'key')).toContain('不回显')
    expect(secretPlaceholder(false, 'key')).toBe('key')
  })

  it('当前值不在预设里时也列出来', () => {
    expect(dailyLimitOptions(7).map(o => o.value)).toEqual([
      3, 5, 7, 10, 20, 50,
    ])
  })
})
