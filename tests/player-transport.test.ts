import { describe, expect, it } from 'vitest'
import {
  clockText,
  remainingText,
} from '../src/renderer/src/features/player/utils/art-transport'
import { enhanceChoices } from '../src/renderer/src/features/player/settings-menu/menu-rules'

describe('控制栏时间文字', () => {
  it('不足一小时写 mm:ss，满一小时写 h:mm:ss', () => {
    expect(clockText(4)).toBe('00:04')
    expect(clockText(125)).toBe('02:05')
    expect(clockText(6392)).toBe('1:46:32')
  })

  it('非法值按 0', () => {
    expect(clockText(Number.NaN)).toBe('00:00')
    expect(clockText(-3)).toBe('00:00')
  })

  it('剩余时间带负号，时长未知时留空', () => {
    expect(remainingText(4, 6392)).toBe('-1:46:28')
    expect(remainingText(7000, 6392)).toBe('-00:00')
    expect(remainingText(4, Number.NaN)).toBe('')
    expect(remainingText(4, Number.POSITIVE_INFINITY)).toBe('')
  })
})

describe('画质增强菜单', () => {
  it('四档，当前档打勾', () => {
    const choices = enhanceChoices('standard')
    expect(choices.map(c => c.value)).toEqual([
      'off',
      'soft',
      'standard',
      'strong',
    ])
    expect(choices.filter(c => c.default).map(c => c.value)).toEqual([
      'standard',
    ])
  })
})
