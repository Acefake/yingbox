import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useSettingsPages } from '../src/renderer/src/features/settings/use-settings-pages'

describe('手机设置页面导航', () => {
  it('平板分屏收窄时保留当前编辑页面', () => {
    const phone = ref(false)
    const pages = useSettingsPages({
      phone,
      select: () => true,
      canLeave: () => false,
    })
    pages.reset(false)
    phone.value = true
    expect(pages.showCategories.value).toBe(false)
  })
  it('普通打开显示分类，明确目标直接进入内容，平板始终展示内容', () => {
    const phone = ref(true)
    const pages = useSettingsPages({
      phone,
      select: () => true,
      canLeave: () => true,
    })
    pages.reset(false)
    expect(pages.showCategories.value).toBe(true)
    pages.reset(true)
    expect(pages.showCategories.value).toBe(false)
    pages.reset(false)
    phone.value = false
    expect(pages.showCategories.value).toBe(false)
  })

  it('选分类后进入详情，返回被拒时保留详情', async () => {
    const allowed = ref(false)
    const pages = useSettingsPages({
      phone: ref(true),
      select: () => true,
      canLeave: () => allowed.value,
    })
    await pages.enter('player')
    expect(pages.showCategories.value).toBe(false)
    await pages.back()
    expect(pages.showCategories.value).toBe(false)
    allowed.value = true
    await pages.back()
    expect(pages.showCategories.value).toBe(true)
  })

  it('旧的异步导航不能在重新打开后进入详情', async () => {
    let finish: (allowed: boolean) => void = () => {}
    const pages = useSettingsPages({
      phone: ref(true),
      select: () =>
        new Promise<boolean>(resolve => {
          finish = resolve
        }),
      canLeave: () => true,
    })
    const entering = pages.enter('player')
    pages.reset(false)
    finish(true)
    await entering
    expect(pages.showCategories.value).toBe(true)
  })
})
