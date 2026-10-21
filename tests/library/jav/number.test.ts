/**
 * 番号解析：常规 / 连写 / FC2 / HEYZO / 日期型 / 素人前缀 / Tokyo-Hot，去字幕与分段标记，文件夹回退。
 */
import { describe, expect, it } from 'vitest'
import {
  codeKey,
  parseJavCode,
} from '../../../src/main/library/providers/jav/number'

const code = (name: string, dirs?: string[]): string | undefined =>
  parseJavCode(name, dirs)?.code

describe('番号解析', () => {
  it.each([
    ['SSIS-497.mp4', 'SSIS-497'],
    ['ssis-497.mkv', 'SSIS-497'],
    ['abp_123.avi', 'ABP-123'],
    ['ABP 123.mp4', 'ABP-123'],
    ['SSIS497.mp4', 'SSIS-497'],
    ['ssis00497.mp4', 'SSIS-497'],
    ['ssis00497hhb.mp4', 'SSIS-497'],
    ['SSIS-0497.mp4', 'SSIS-497'],
    ['IPX-01.mp4', 'IPX-001'],
    ['hhd800.com@SSIS-497.mp4', 'SSIS-497'],
    ['[javbus.com]SSIS-497.mp4', 'SSIS-497'],
    ['【中文字幕】SSIS-497 最高のオンナ.mp4', 'SSIS-497'],
    ['SSIS-497.1080p.H265.mp4', 'SSIS-497'],
    ['4K-SSIS-497.mp4', 'SSIS-497'],
    ['www.javbus.com SSIS-497.mp4', 'SSIS-497'],
  ])('常规番号 %s → %s', (name, expected) => {
    expect(code(name)).toBe(expected)
  })

  it.each([
    ['FC2-PPV-1234567.mp4', 'FC2-PPV-1234567'],
    ['FC2PPV-1234567.mp4', 'FC2-PPV-1234567'],
    ['fc2-ppv_3662771.mp4', 'FC2-PPV-3662771'],
    ['FC2-3662771.mp4', 'FC2-PPV-3662771'],
    ['fc2ppv 3662771 1080p.mp4', 'FC2-PPV-3662771'],
  ])('FC2 %s → %s', (name, expected) => {
    expect(parseJavCode(name)).toMatchObject({ code: expected, kind: 'fc2' })
  })

  it.each([
    ['HEYZO-0841.mp4', 'HEYZO-0841'],
    ['heyzo_841.mp4', 'HEYZO-0841'],
    ['HEYZO0841.mp4', 'HEYZO-0841'],
    ['010120-001-carib.mp4', '010120-001'],
    ['Carib 010120-001.mp4', '010120-001'],
    ['010120_001-1pon.mp4', '010120_001'],
    ['120115_318-mura-1080p.mp4', '120115_318'],
    ['n1234.mp4', 'n1234'],
    ['Tokyo-Hot n1234.mp4', 'n1234'],
  ])('无码 %s → %s', (name, expected) => {
    expect(parseJavCode(name)).toMatchObject({
      code: expected,
      kind: 'uncensored',
    })
  })

  it.each([
    ['259LUXU-1234.mp4', '259LUXU-1234'],
    ['300MIUM-123.mp4', '300MIUM-123'],
    ['200GANA2345.mp4', '200GANA-2345'],
    ['SIRO-4321.mp4', 'SIRO-4321'],
  ])('素人 %s → %s', (name, expected) => {
    expect(parseJavCode(name)).toMatchObject({
      code: expected,
      kind: 'amateur',
    })
  })

  it('有码 / 无码厂牌前缀分类', () => {
    expect(parseJavCode('SSIS-497.mp4')?.kind).toBe('censored')
    expect(parseJavCode('SKYHD-123.mp4')?.kind).toBe('uncensored')
  })

  it('字幕与分段标记不进番号', () => {
    expect(parseJavCode('SSIS-497-C.mp4')).toEqual({
      code: 'SSIS-497',
      kind: 'censored',
      subtitle: true,
    })
    expect(parseJavCode('SSIS-497-UC.mp4')).toMatchObject({
      code: 'SSIS-497',
      subtitle: true,
    })
    expect(parseJavCode('SSIS-497_C.mp4')).toMatchObject({
      code: 'SSIS-497',
      subtitle: true,
    })
    expect(parseJavCode('SSIS-497 中文字幕.mp4')).toMatchObject({
      subtitle: true,
    })
    expect(parseJavCode('SSIS-497-CD1.mp4')).toMatchObject({
      code: 'SSIS-497',
      part: 1,
      subtitle: false,
    })
    expect(parseJavCode('SSIS-497.part2.mp4')).toMatchObject({
      code: 'SSIS-497',
      part: 2,
    })
    expect(parseJavCode('SSIS-497-2.mp4')).toMatchObject({
      code: 'SSIS-497',
      part: 2,
    })
    expect(parseJavCode('SSIS-497-C-CD2.mp4')).toMatchObject({
      subtitle: true,
      part: 2,
    })
    expect(parseJavCode('FC2-PPV-1234567-1.mp4')).toMatchObject({
      code: 'FC2-PPV-1234567',
      part: 1,
    })
  })

  it('文件名没有番号时退到文件夹名（近的优先，只用严格规则）', () => {
    expect(code('movie.mp4', ['JAV', 'SSIS-497 最高のオンナ'])).toBe('SSIS-497')
    expect(code('CD1.mp4', ['ABP-123', 'SSIS-497'])).toBe('SSIS-497')
    expect(parseJavCode('cd2.mp4', ['SSIS-497'])).toMatchObject({
      code: 'SSIS-497',
      part: 2,
    })
    // 文件夹名不走连写规则，避免把普通文件夹名当番号
    expect(code('movie.mp4', ['Collection2023'])).toBeUndefined()
  })

  it('认不出时返回 null，不把原文件名当番号', () => {
    expect(parseJavCode('random video.mp4')).toBeNull()
    expect(parseJavCode('CD1.mp4')).toBeNull()
    expect(parseJavCode('1080p.mp4')).toBeNull()
  })

  it('比较键：忽略分隔符、大小写与数字前导零', () => {
    expect(codeKey('SSIS-049')).toBe(codeKey('ssis49'))
    expect(codeKey('SSIS-497')).toBe('ssis497')
    expect(codeKey('FC2-PPV-1234567')).toBe('fc2ppv1234567')
    expect(codeKey('SSIS-497')).not.toBe(codeKey('SSIS-498'))
  })
})
