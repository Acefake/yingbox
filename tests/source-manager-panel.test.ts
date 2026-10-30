/**
 * 数据源面板（嵌入设置窗口时）的渲染结构：工具栏、内置 CMS / 插件 / 自定义三个分组、
 * 插件源不可用时的红点与说明、成人模式下的分类切换。拆分组件前后渲染结果应一致。
 * SM_DUMP=<文件> 时把规整后的 HTML 写出来，用于拆分前后逐字比较。
 */
import { writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { h } from 'vue'

// 渲染进程模块在导入时读 localStorage（网页版设置、源列表），node 环境里给一个内存版
vi.hoisted(() => {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
})
import { renderToString } from 'vue/server-renderer'
import SourceManagerPanel from '../src/renderer/src/features/online/components/SourceManagerPanel.vue'
import { setSetting } from '../src/renderer/src/features/settings'
import { useOnlineSearch } from '../src/renderer/src/features/online/composables/use-online-search'
import {
  markPluginOk,
  markPluginUnavailable,
} from '../src/renderer/src/features/online/composables/plugin-health'
import {
  checkedCount,
  checkingAll,
} from '../src/renderer/src/features/online/composables/use-source-refresh'
import { cmsHealth } from '../src/renderer/src/features/online/composables/cms-health'

/** 去掉 scoped 样式属性与注释锚点，只比结构和文字。 */
const normalize = (html: string): string =>
  html.replace(/ data-v-[0-9a-f]{8}(="")?/g, '').replace(/<!--[\s\S]*?-->/g, '')

const render = async (): Promise<string> =>
  normalize(
    await renderToString(
      h(SourceManagerPanel, { visible: true, embedded: true })
    )
  )

const { customSites, DEFAULT_SITES, CATSPIDER_SITES } = useOnlineSearch()

afterEach(async () => {
  customSites.value = []
  cmsHealth.clear()
  checkingAll.value = false
  checkedCount.value = 0
  CATSPIDER_SITES.value = []
  markPluginOk('NO視頻')
  await setSetting('app.adultMode', false)
})

describe('数据源面板渲染', () => {
  it('工具栏 + 三个分组；失效源计数与按连接状态排序；自定义源可删除', async () => {
    customSites.value = [
      { name: '我的源', api: 'https://my.test/api.php' },
      { name: '坏源', api: 'https://bad.test/api.php' },
    ]
    CATSPIDER_SITES.value = [
      { name: 'NO視頻', type: 3, api: 'csp_novipnoad', ext: 'x' },
      { name: '瓜子', type: 3, api: 'csp_guazi', ext: 'y' },
      { name: 'jable', type: 3, api: 'csp_jable', ext: 'z' },
    ]
    for (let i = 0; i < 3; i++)
      cmsHealth.failure(
        'https://bad.test/api.php',
        'browse',
        new Error('HTTP 503')
      )
    cmsHealth.success(DEFAULT_SITES[1].api, 'browse')
    checkingAll.value = true
    checkedCount.value = 3
    markPluginUnavailable('NO視頻', {
      host: 'www.novipnoad.net',
      reason: 'challenge',
      until: Date.now() + 30 * 60_000,
      scope: 'search',
    })
    const html = await render()
    if (process.env.SM_DUMP) writeFileSync(process.env.SM_DUMP, html)
    expect(html).toContain('class="smp-embedded"')
    expect(html).toContain('检测中 3/')
    expect(html).toContain('停用失效源（1）')
    expect(html).toContain('一键更新：同步并检测全部数据源')
    expect(html).toContain('内置 CMS 源')
    expect(html).toContain('插件视频源')
    expect(html).toContain('自定义源')
    expect(html).toContain('添加自定义源')
    // 成人插件不出现在在线源的插件分组
    expect(html).toContain('瓜子')
    expect(html).not.toContain('jable')
    expect(html).toContain('搜索站点验证未通过 · 约 30 分钟后自动重试')
    expect(html).toContain('重试数据源 NO視頻')
    // 内置源按连接状态排序：检测通过的排在最前
    expect(html.indexOf(DEFAULT_SITES[1].name)).toBeLessThan(
      html.indexOf(DEFAULT_SITES[0].name)
    )
    expect(html).toContain('坏源')
    // 只有一个分类时不显示分类切换
    expect(html).not.toContain('数据源分类')
  })

  it('成人模式：出现「数据源分类」切换，默认仍在在线源', async () => {
    await setSetting('app.adultMode', true)
    const html = await render()
    if (process.env.SM_DUMP) writeFileSync(`${process.env.SM_DUMP}.adult`, html)
    expect(html).toContain('数据源分类')
    expect(html).toContain('内置 CMS 源')
  })

  it('不可见时不渲染', async () => {
    const html = normalize(
      await renderToString(
        h(SourceManagerPanel, { visible: false, embedded: true })
      )
    )
    expect(html).not.toContain('smp-')
  })
})
