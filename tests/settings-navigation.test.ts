import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { SettingsSection } from '../src/renderer/src/features/settings/registry'
import { useSectionNavigation } from '../src/renderer/src/features/settings/use-section-navigation'

const section = (
  id: string,
  extra: Partial<SettingsSection> = {}
): SettingsSection => ({
  id,
  title: id,
  icon: 'sun',
  keywords: '',
  load: async () => ({ default: {} }),
  ...extra,
})

const SECTIONS = [
  section('appearance', { keywords: '主题 深色' }),
  section('player', { keywords: 'mpv', props: { embedded: true } }),
  section('lada', { keywords: '马赛克', adultOnly: true }),
]

const setup = (adult = false, allowLeave = true) => {
  const adultMode = ref(adult)
  const leave = { ok: allowLeave }
  const nav = useSectionNavigation({
    sections: () => SECTIONS,
    adultMode,
    canLeave: () => leave.ok,
  })
  return { nav, adultMode, leave }
}

describe('设置分区导航', () => {
  it('成人模式关闭时隐藏 adultOnly 分区，打开后出现', () => {
    const { nav, adultMode } = setup()
    expect(nav.visibleSections.value.map(s => s.id)).toEqual([
      'appearance',
      'player',
    ])
    adultMode.value = true
    expect(nav.visibleSections.value.map(s => s.id)).toContain('lada')
  })

  it('搜索按标题与关键词过滤，并自动跳到第一个结果', async () => {
    const { nav } = setup()
    nav.navQuery.value = 'MPV'
    await nextTick()
    expect(nav.visibleSections.value.map(s => s.id)).toEqual(['player'])
    expect(nav.current.value?.id).toBe('player')
  })

  it('当前分区拒绝离开时不切换；搜索导致的切换被拒则清空搜索词', async () => {
    const { nav, leave } = setup()
    leave.ok = false
    expect(nav.selectSection('player')).toBe(false)
    expect(nav.current.value?.id).toBe('appearance')
    nav.navQuery.value = 'mpv'
    await nextTick()
    expect(nav.navQuery.value).toBe('')
    expect(nav.current.value?.id).toBe('appearance')
  })

  it('openTarget 解析 "<分区>:<子页>"，子页与分区固定属性一起传给分区', () => {
    const { nav } = setup()
    nav.navQuery.value = 'x'
    nav.openTarget('player:mpv')
    expect(nav.current.value?.id).toBe('player')
    expect(nav.sectionProps.value).toEqual({ embedded: true, sub: 'mpv' })
    expect(nav.navQuery.value).toBe('')
  })

  it('openTarget 指向不可用分区（成人模式关闭时的 lada）时忽略', () => {
    const { nav } = setup()
    nav.openTarget('lada')
    expect(nav.current.value?.id).toBe('appearance')
  })
})
