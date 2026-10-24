import { describe, expect, it } from 'vitest'
import {
  type SettingsSection,
  registerSettingsSection,
  settingsSections,
} from '../src/renderer/src/features/settings/registry'

const section = (id: string, order?: number): SettingsSection => ({
  id,
  title: id,
  icon: 'sun',
  keywords: '',
  load: async () => ({ default: {} }),
  order,
})

const ids = (): string[] => settingsSections.map(s => s.id)

describe('设置分区注册表', () => {
  it('其它 feature 登记的分区按 order 插到原来的位置', () => {
    registerSettingsSection(section('lada', 70))
    registerSettingsSection(section('sources', 50))
    registerSettingsSection(section('extra', 90))
    expect(ids()).toEqual([
      'appearance',
      'images',
      'scrape',
      'provider',
      'sources',
      'player',
      'ai',
      'lada',
      'update',
      'extra',
    ])
  })

  it('同 id 重复登记时替换而不重复，且可改变位置', () => {
    const replacement = section('sources', 15)
    registerSettingsSection(replacement)
    expect(ids().filter(id => id === 'sources')).toHaveLength(1)
    expect(ids().indexOf('sources')).toBe(1)
    expect(settingsSections[1]).toBe(replacement)
  })

  it('缺省 order 的分区排在最后', () => {
    registerSettingsSection(section('extra'))
    expect(ids().at(-1)).toBe('extra')
  })
})
