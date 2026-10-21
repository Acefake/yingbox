/**
 * FC2PPVDB（fc2cmadb.com）：fixture 是真实页面（首屏 Inertia 页面 JSON，去掉了界面文案表）
 * 与演员局部请求的真实 JSON 响应。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseJavCode } from '../src/main/library/providers/jav/number'
import {
  fc2ppvdb,
  fc2ppvdbActresses,
  fc2ppvdbRecord,
  inertiaFromHtml,
  inertiaFromJson,
} from '../src/main/library/providers/jav/sites/fc2ppvdb'
import type { PageOptions } from '../src/main/library/providers/jav/types'

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures/jav', name), 'utf8')

const URL_ = 'https://fc2cmadb.com/articles/3662771'

describe('FC2PPVDB', () => {
  it('首屏页面对象：组件、版本、延迟 props', () => {
    const page = inertiaFromHtml(fixture('fc2ppvdb-3662771.html'))!
    expect(page.component).toBe('Articles/Show')
    expect(page.version).toBe('fcb3b524d4c7f8f3d2c38e437b35b7a9')
    expect(page.deferred).toEqual(['actresses'])
  })

  it('旧版嵌法 <div id="app" data-page="…">', () => {
    const json = JSON.stringify({
      component: 'Articles/Show',
      props: { a: 1 },
      version: 'v',
    })
    const html = `<div id="app" data-page="${json.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div>`
    expect(inertiaFromHtml(html)).toMatchObject({
      component: 'Articles/Show',
      version: 'v',
    })
  })

  it('作品字段', () => {
    const page = inertiaFromHtml(fixture('fc2ppvdb-3662771.html'))!
    expect(fc2ppvdbRecord(page, URL_, '3662771')).toMatchObject({
      site: 'fc2ppvdb',
      code: 'FC2-PPV-3662771',
      title: expect.stringMatching(/^【豊満巨乳のスナックママメイン版】/),
      releaseDate: '2023-08-10',
      runtimeMinutes: 53,
      studio: '素人0930',
      tags: [
        '人妻',
        'ハメ撮り',
        '素人',
        '中出し',
        '個人撮影',
        '無修正',
        '熟女',
        '潮吹き',
        'パイズリ',
      ],
      poster: expect.stringMatching(
        /^https:\/\/contents-thumbnail2\.fc2\.com\//
      ),
      actors: [],
    })
    // 页面对象不是这部作品
    expect(fc2ppvdbRecord(page, URL_, '1')).toBeNull()
  })

  it('演员局部请求的响应', () => {
    const page = inertiaFromJson(fixture('fc2ppvdb-3662771-actresses.json'))!
    expect(fc2ppvdbActresses(page.props)).toEqual([
      '某エリート官僚の美人熟女妻',
      '高田恵子',
    ])
  })

  it('不存在的作品页（Error 组件）返回 null', () => {
    const page = inertiaFromHtml(fixture('fc2ppvdb-missing.html'))!
    expect(page.component).toBe('Error')
    expect(fc2ppvdbRecord(page, URL_, '3662771')).toBeNull()
  })

  it('查询流程：首屏 + 演员局部请求（带 Inertia 请求头与版本）', async () => {
    const calls: Array<{ url: string; options?: PageOptions }> = []
    const r = await fc2ppvdb.fetch(parseJavCode('FC2-PPV-3662771.mp4')!, {
      page: async (url, options) => {
        calls.push({ url, options })
        return options?.headers?.['X-Inertia']
          ? fixture('fc2ppvdb-3662771-actresses.json')
          : fixture('fc2ppvdb-3662771.html')
      },
    })
    expect(r?.actors.map(a => a.name)).toEqual([
      '某エリート官僚の美人熟女妻',
      '高田恵子',
    ])
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual({
      url: URL_,
      options: {
        headers: expect.objectContaining({
          'X-Inertia': 'true',
          'X-Inertia-Version': 'fcb3b524d4c7f8f3d2c38e437b35b7a9',
          'X-Inertia-Partial-Component': 'Articles/Show',
          'X-Inertia-Partial-Data': 'actresses',
        }),
      },
    })
  })

  it('404 不发第二个请求；只查 FC2', async () => {
    let count = 0
    const r = await fc2ppvdb.fetch(parseJavCode('FC2-PPV-12345.mp4')!, {
      page: async () => {
        count++
        return null
      },
    })
    expect(r).toBeNull()
    expect(count).toBe(1)
    expect(fc2ppvdb.supports('censored')).toBe(false)
  })
})
