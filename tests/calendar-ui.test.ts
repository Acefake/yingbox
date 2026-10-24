// test-affected: repo-wide
/**
 * 追剧日历界面（源码级）：组件能编译、路由与侧栏入口已登记、卡片与页面只用 Ui* 组件、
 * 侧栏角标有无障碍名称、在线页接住日历的「打开详情」请求。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

import { routes } from '../src/renderer/src/router/routers'

const ROOT = join(__dirname, '..', 'src', 'renderer', 'src')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

const SFCS = [
  'features/calendar/views/CalendarView.vue',
  'features/calendar/components/CalendarCard.vue',
  'features/shell/components/AppSidebar.vue',
]

describe('追剧日历界面', () => {
  it.each(SFCS)('%s 能编译', path => {
    const { descriptor, errors } = parse(read(path), { filename: path })
    expect(errors).toEqual([])
    const script = compileScript(descriptor, { id: path, inlineTemplate: true })
    expect(script.content.length).toBeGreaterThan(0)
    const template = compileTemplate({
      source: descriptor.template!.content,
      filename: path,
      id: path,
    })
    expect(template.errors).toEqual([])
  })

  it('路由 /calendar 指向日历页', () => {
    const route = routes.find(r => r.path === '/calendar')
    expect(route).toMatchObject({ name: 'Calendar' })
    expect(route?.meta?.title).toBe('追剧日历')
  })

  it('卡片：UiPressable 整卡可点、16:9 图、状态文案；页面用 UiSegmented 切视图', () => {
    const card = read('features/calendar/components/CalendarCard.vue')
    expect(card).toContain('<UiPressable')
    expect(card).toContain('aspect-ratio: 16 / 9')
    expect(card).toContain('STATUS_LABEL[entry.status]')
    expect(card).not.toMatch(/<button[\s>]/)
    const view = read('features/calendar/views/CalendarView.vue')
    expect(view).toContain('<UiSegmented')
    expect(view).toContain('label="上一周"')
    expect(view).toContain('label="下一周"')
    expect(view).toContain(':aria-current="day.isToday ? \'date\' : undefined"')
    expect(view).toContain('playLibraryEpisode')
    expect(view).toContain('requestOnlineDetail')
  })

  it('侧栏角标：数字放在 trailing 插槽，无障碍名称带上未看集数', () => {
    const sidebar = read('features/shell/components/AppSidebar.vue')
    expect(sidebar).toContain('#trailing')
    expect(sidebar).toContain('class="sidebar-badge"')
    expect(sidebar).toContain('集未看')
    const layout = read('features/shell/AppLayout.vue')
    expect(layout).toContain("from '@/features/calendar'")
    expect(layout).toContain('calendarBadge: calendarBadge.value')
  })

  it('在线页接住别处请求的详情', () => {
    const online = read('features/online/views/OnlineView.vue')
    expect(online).toContain('pendingOnlineDetail()')
    expect(online).toContain('takeOnlineDetail()')
  })
})
