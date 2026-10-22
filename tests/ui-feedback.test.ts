import { ESLint } from 'eslint'
import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type ConfirmOptions, createConfirmFlow } from '@/components/ui/confirm'
import UiConfirmDialog from '@/components/ui/UiConfirmDialog.vue'
import {
  MAX_TOASTS,
  TOAST_DURATION,
  toast,
  toastItems,
} from '@/components/ui/toast'
import UiToastHost from '@/components/ui/UiToastHost.vue'
import { parseClock, readRange } from '@/features/lada/utils/range-input'

const texts = (): string[] =>
  toastItems.map(item => `${item.kind}:${item.text}`)

describe('toast 队列', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    toast.clear()
    vi.useRealTimers()
  })

  it('按种类的默认时长自动消失，错误停得比成功久', () => {
    toast.success('已保存')
    toast.error('失败了')
    expect(texts()).toEqual(['success:已保存', 'error:失败了'])
    vi.advanceTimersByTime(TOAST_DURATION.success)
    expect(texts()).toEqual(['error:失败了'])
    vi.advanceTimersByTime(TOAST_DURATION.error - TOAST_DURATION.success)
    expect(texts()).toEqual([])
    expect(TOAST_DURATION.error).toBeGreaterThan(TOAST_DURATION.success)
  })

  it('loading 与 duration 0 不自动消失，用返回的函数收起', () => {
    const done = toast.loading('正在解析…')
    const sticky = toast.info('一直在', { duration: 0 })
    vi.advanceTimersByTime(60_000)
    expect(texts()).toEqual(['loading:正在解析…', 'info:一直在'])
    done()
    done()
    expect(texts()).toEqual(['info:一直在'])
    sticky()
    expect(texts()).toEqual([])
  })

  it('同种类同文字不叠加，只重新计时', () => {
    toast.success('已复制')
    vi.advanceTimersByTime(TOAST_DURATION.success - 100)
    toast.success('已复制')
    toast.error('已复制')
    expect(texts()).toEqual(['success:已复制', 'error:已复制'])
    vi.advanceTimersByTime(200)
    expect(texts()).toContain('success:已复制')
    vi.advanceTimersByTime(TOAST_DURATION.success)
    expect(texts()).not.toContain('success:已复制')
  })

  it(`最多 ${MAX_TOASTS} 条，超出挤掉最早的`, () => {
    for (let i = 1; i <= MAX_TOASTS + 2; i++) toast.info(`第 ${i} 条`)
    expect(texts()).toEqual(
      Array.from({ length: MAX_TOASTS }, (_, i) => `info:第 ${i + 3} 条`)
    )
  })

  it('被挤掉或提前关闭的条目，计时器不会误删后来的条目', () => {
    const first = toast.info('a', { duration: 1000 })
    first()
    toast.info('b', { duration: 5000 })
    vi.advanceTimersByTime(1500)
    expect(texts()).toEqual(['info:b'])
  })
})

describe('UiToastHost 渲染', () => {
  it('error 用 alert 立即播报，loading 显示转圈不显示图标', async () => {
    const html = await renderToString(
      h(UiToastHost, {
        items: [
          { id: 1, kind: 'error', text: '出错了' },
          { id: 2, kind: 'loading', text: '加载中' },
          { id: 3, kind: 'success', text: '好了' },
        ],
      })
    )
    expect(html).toMatch(/class="is-error ui-toast" role="alert"/)
    expect(html).toMatch(/class="is-success ui-toast" role="status"/)
    expect(html).toContain('ui-toast__spinner')
    expect(html.match(/ui-toast__icon/g)).toHaveLength(2)
    expect(html).toContain('出错了')
  })
})

describe('确认流程', () => {
  it('确认：onOk 成功后以 true 结束，只结束一次', async () => {
    const settle = vi.fn()
    const onOk = vi.fn()
    const flow = createConfirmFlow(onOk, settle)
    await flow.ok()
    await flow.ok()
    flow.cancel()
    expect(onOk).toHaveBeenCalledTimes(1)
    expect(settle.mock.calls).toEqual([[true]])
    expect(flow.state.settled).toBe(true)
  })

  it('取消：以 false 结束，不执行 onOk', () => {
    const settle = vi.fn()
    const onOk = vi.fn()
    const flow = createConfirmFlow(onOk, settle)
    flow.cancel()
    expect(onOk).not.toHaveBeenCalled()
    expect(settle.mock.calls).toEqual([[false]])
  })

  it('onOk 抛错：不关闭，显示错误；改对后再确认成功', async () => {
    const settle = vi.fn()
    let valid = false
    const flow = createConfirmFlow(() => {
      if (!valid) throw new Error('起点格式不对')
    }, settle)
    await flow.ok()
    expect(settle).not.toHaveBeenCalled()
    expect(flow.state).toMatchObject({
      busy: false,
      settled: false,
      error: '起点格式不对',
    })
    valid = true
    await flow.ok()
    expect(flow.state.error).toBe('')
    expect(settle.mock.calls).toEqual([[true]])
  })

  it('异步 onOk 进行中：busy，取消和重复确认都被忽略', async () => {
    const settle = vi.fn()
    let release!: () => void
    const onOk = vi.fn(() => new Promise<void>(resolve => (release = resolve)))
    const flow = createConfirmFlow(onOk, settle)
    const pending = flow.ok()
    expect(flow.state.busy).toBe(true)
    flow.cancel()
    void flow.ok()
    expect(onOk).toHaveBeenCalledTimes(1)
    release()
    await pending
    expect(flow.state.busy).toBe(false)
    expect(settle.mock.calls).toEqual([[true]])
  })

  it('异步 onOk 拒绝：恢复可点并显示错误', async () => {
    const settle = vi.fn()
    const flow = createConfirmFlow(
      () => Promise.reject(new Error('网络错误')),
      settle
    )
    await flow.ok()
    expect(flow.state).toMatchObject({
      busy: false,
      settled: false,
      error: '网络错误',
    })
    flow.cancel()
    expect(settle.mock.calls).toEqual([[false]])
  })
})

describe('UiConfirmDialog 渲染', () => {
  const render = (options: ConfirmOptions, error = ''): Promise<string> => {
    const flow = createConfirmFlow(undefined, () => {})
    flow.state.error = error
    return renderToString(h(UiConfirmDialog, { options, flow }))
  }

  it('默认按钮文字、主按钮 primary、标题与说明', async () => {
    const html = await render({
      title: '清空搜索记录？',
      content: '将清除 3 条',
    })
    expect(html).toContain('<dialog')
    expect(html).toContain('清空搜索记录？')
    expect(html).toContain('将清除 3 条')
    expect(html).toMatch(/取消/)
    expect(html).toMatch(/class="ui-button is-primary[^"]*"[^>]*autofocus/)
    expect(html).not.toContain('is-danger')
    expect(html).toContain('width:360px')
  })

  it('danger：确认按钮危险色，焦点默认落在取消', async () => {
    const html = await render({
      title: '删除？',
      okText: '删除',
      danger: true,
      width: 460,
    })
    expect(html).toMatch(/class="ui-button is-danger[^"]*"/)
    expect(html).toMatch(/class="ui-button is-secondary[^"]*"[^>]*autofocus/)
    expect(html).not.toMatch(/is-danger[^"]*"[^>]*autofocus/)
    expect(html).toContain('width:460px')
  })

  it('渲染函数内容与校验错误', async () => {
    const html = await render(
      {
        title: '只去码一段',
        content: () => h('label', { class: 'probe' }, '起点'),
      },
      '终点要大于起点'
    )
    expect(html).toContain('class="probe"')
    expect(html).toMatch(/role="alert"[^>]*>\s*终点要大于起点/)
  })
})

describe('去码区间输入', () => {
  it('parseClock：秒数、分:秒、时:分:秒，其余为 null', () => {
    expect(parseClock('630')).toBe(630)
    expect(parseClock(' 10:30 ')).toBe(630)
    expect(parseClock('1:02:03')).toBe(3723)
    expect(parseClock('')).toBeNull()
    expect(parseClock('1:2:3:4')).toBeNull()
    expect(parseClock('10:xx')).toBeNull()
  })

  it('readRange：终点留空到片尾，格式错与终点不大于起点抛错', () => {
    expect(readRange('10:00', '')).toEqual({ start: 600, end: 0 })
    expect(readRange('10:00', '20:00')).toEqual({ start: 600, end: 1200 })
    expect(() => readRange('abc', '')).toThrow('起点')
    expect(() => readRange('10:00', 'x')).toThrow('终点填成')
    expect(() => readRange('10:00', '10:00')).toThrow('终点要大于起点')
  })
})

describe('eslint 禁止再引入 antd', { timeout: 30_000 }, () => {
  const eslint = new ESLint({
    cwd: process.cwd(),
    ruleFilter: ({ ruleId }) => ruleId === 'no-restricted-imports',
  })
  const lint = async (code: string, filePath: string): Promise<string[]> => {
    const [result] = await eslint.lintText(code, { filePath })
    return result.messages.map(m => m.ruleId ?? '')
  }

  it('渲染层、主进程、脚本里 import antd 都报错', async () => {
    const code = [
      "import { message } from 'ant-design-vue'",
      "import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context'",
      "import { SmileOutlined } from '@ant-design/icons-vue'",
      'export { message, SmileOutlined }',
      'export type { ThemeConfig }',
    ].join('\n')
    for (const file of [
      'src/renderer/src/features/av/composables/antd-probe.ts',
      'src/main/antd-probe.ts',
      'scripts/antd-probe.mjs',
    ]) {
      expect(await lint(code, file), file).toEqual([
        'no-restricted-imports',
        'no-restricted-imports',
        'no-restricted-imports',
      ])
    }
  })

  it('渲染层的 axios 禁令与主进程的 IPC 禁令仍然生效', async () => {
    expect(
      await lint(
        "import axios from 'axios'\nexport default axios",
        'src/renderer/src/features/av/composables/axios-probe.ts'
      )
    ).toEqual(['no-restricted-imports'])
    expect(
      await lint(
        "import { ipcMain } from 'electron'\nexport { ipcMain }",
        'src/renderer/src/features/av/composables/ipc-probe.ts'
      )
    ).toEqual(['no-restricted-imports'])
  })
})
