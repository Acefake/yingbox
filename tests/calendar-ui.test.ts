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
  'features/calendar/components/CalendarRow.vue',
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

  it('列表视图的 v-else 接在周视图分支上，周模式不会连带渲染列表', () => {
    const path = 'features/calendar/views/CalendarView.vue'
    // 换个 filename 绕开 parse 的缓存：上面的编译用例会把同一份 AST 里的 v-if/v-else 改写成分支节点
    const { descriptor } = parse(read(path), { filename: `${path}?ast` })
    type Node = {
      type: number
      tag?: string
      children?: Node[]
      props?: { name: string; rawName?: string; exp?: { content: string } }[]
    }
    const page = (descriptor.template!.ast!.children as Node[]).find(
      node => node.type === 1
    )!
    const elements = (page.children ?? []).filter(node => node.type === 1)
    const directive = (node: Node, name: string): string | undefined =>
      node.props?.find(prop => prop.rawName === name)?.exp?.content ??
      (node.props?.some(prop => prop.rawName === name) ? '' : undefined)
    const list = elements.findIndex(node => directive(node, 'v-else') === '')
    expect(list).toBeGreaterThan(0)
    const branch = elements[list - 1]
    expect(branch.tag).toBe('template')
    expect(directive(branch, 'v-if')).toBe("cal.mode.value === 'week'")
  })

  it('路由 /calendar 指向日历页', () => {
    const route = routes.find(r => r.path === '/calendar')
    expect(route).toMatchObject({ name: 'Calendar' })
    expect(route?.meta?.title).toBe('追剧日历')
  })

  it('行：UiPressable 整行可点、小剧照、状态文案、无渐进模糊；同剧同日合并；页面用 UiSegmented 切视图', () => {
    const row = read('features/calendar/components/CalendarRow.vue')
    expect(row).toContain('<UiPressable')
    expect(row).toContain('STATUS_LABEL[group.status]')
    expect(row).not.toContain('yb-pblur')
    expect(row).not.toMatch(/<button[\s>]/)
    const view = read('features/calendar/views/CalendarView.vue')
    expect(view).toContain('groupShowsByDay')
    expect(view).toContain('<UiSegmented')
    expect(view).toContain('label="上一周"')
    expect(view).toContain('label="下一周"')
    expect(view).toContain(':aria-current="day.isToday ? \'date\' : undefined"')
    expect(view).toContain('playLibraryEpisode')
    expect(view).toContain('requestOnlineDetail')
  })

  it('追更小标记：卡片外另一个按钮（不嵌套），点了展开追更面板并定位', () => {
    const card = read('features/calendar/components/CalendarRow.vue')
    const pressableEnd = card.indexOf('</UiPressable>')
    expect(card.indexOf('<AutograbMarkChip')).toBeGreaterThan(pressableEnd)
    expect(card).toContain("from '@/features/autograb'")
    const view = read('features/calendar/views/CalendarView.vue')
    expect(view).toContain('@mark="openAutograb"')
    expect(view).toContain(':focus-key="autograbFocus"')
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
