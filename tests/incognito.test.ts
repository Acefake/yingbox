// @vitest-environment jsdom
// test-affected: repo-wide
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  incognitoState,
  isIncognito,
  setIncognito,
  toggleIncognito,
} from '../src/renderer/src/features/incognito/incognito-state'
import {
  continueRecords,
  finishContinue,
  removeContinue,
  startContinue,
  updateContinue,
} from '../src/renderer/src/features/player/continue/continue-store'
import {
  getMediaProgress,
  saveMediaProgress,
} from '../src/renderer/src/features/player/utils/play-progress'

/**
 * 无痕模式：会话级开关；打开时续播进度、在线播放历史里的进度、继续播放都不写，
 * 用户手动移除 / 标记看完照常；所有写观看痕迹的地方都经 isIncognito() 判断；侧栏有开关与标识。
 */

const RENDERER = join(__dirname, '../src/renderer/src')
const read = (path: string): string =>
  readFileSync(join(RENDERER, path), 'utf8')

const meta = (key: string) =>
  ({ section: 'movie', key, title: `片 ${key}` }) as const

beforeEach(() => {
  localStorage.clear()
  setIncognito(false)
})
afterEach(() => setIncognito(false))

describe('开关', () => {
  it('默认关闭，切换 / 设置，只读状态跟着变；不写任何存储', () => {
    const state = incognitoState()
    expect(isIncognito()).toBe(false)
    expect(toggleIncognito()).toBe(true)
    expect(state.value).toBe(true)
    setIncognito(false)
    expect(state.value).toBe(false)
    expect(localStorage.length).toBe(0)
    expect(read('features/incognito/incognito-state.ts')).not.toMatch(
      /storage|localStorage|setSetting/i
    )
  })
})

describe('续播进度', () => {
  it('无痕时不写进度表，也不改在线播放历史里的进度', () => {
    localStorage.setItem(
      'online_play_history',
      JSON.stringify([{ url: 'https://a/1.m3u8', progress: 5 }])
    )
    setIncognito(true)
    saveMediaProgress('https://a/1.m3u8', 900, 1800)
    saveMediaProgress('/m/a.mkv', 900, 1800)
    expect(localStorage.getItem('media_play_progress')).toBeNull()
    expect(getMediaProgress('https://a/1.m3u8')).toBe(5)
    setIncognito(false)
    saveMediaProgress('/m/a.mkv', 900, 1800)
    expect(getMediaProgress('/m/a.mkv')).toBe(900)
  })
})

describe('继续播放', () => {
  it('无痕时开播不登记（返回空串），已有记录不记进度', () => {
    const id = startContinue(meta('1'), { filePath: '/m/1.mkv' })
    updateContinue(id, { index: 0, progress: 600, duration: 6000 })
    setIncognito(true)
    expect(startContinue(meta('2'), { filePath: '/m/2.mkv' })).toBe('')
    updateContinue(id, { index: 0, progress: 3000, duration: 6000 })
    const records = continueRecords().value
    expect(records.map(r => r.id)).toEqual(['movie:1'])
    expect(records[0].progress).toBe(600)
  })

  it('无痕时用户手动标记看完 / 移除照常', () => {
    const a = startContinue(meta('3'), { filePath: '/m/3.mkv' })
    const b = startContinue(meta('4'), { filePath: '/m/4.mkv' })
    updateContinue(a, { index: 0, progress: 600, duration: 6000 })
    setIncognito(true)
    finishContinue(a)
    removeContinue(b)
    const ids = continueRecords().value.map(r => r.id)
    expect(ids).not.toContain('movie:3')
    expect(ids).not.toContain('movie:4')
  })
})

describe('写入点都经 isIncognito()', () => {
  it('在线播放历史、AV 播放历史、续播进度、继续播放各自判断', () => {
    expect(read('features/online/components/DetailWindow.vue')).toMatch(
      /const recordHistory = [^\n]+\n\s+if \(isIncognito\(\)\) return/
    )
    expect(read('features/av/composables/use-av-playback.ts')).toMatch(
      /if \(playingVideo\.value && !isIncognito\(\)\)\s+playHistory\.value = upsertPlayHistory/
    )
    expect(read('features/player/utils/play-progress.ts')).toContain(
      'if (!key || isIncognito()) return'
    )
    expect(read('features/player/progress/progress-events.ts')).toContain(
      'if (!isIncognito()) markWatched(target.key)'
    )
    const store = read('features/player/continue/continue-store.ts')
    expect(store).toContain("if (isIncognito()) return ''")
    expect(store).toContain('if (!id || isIncognito()) return')
  })

  it('渲染层里写观看痕迹的调用只出现在已判断的模块里', () => {
    // 新增写入点时要么经这些函数，要么在这里登记并加判断
    const writers =
      /saveMediaProgress\(|upsertPlayHistory\(|saveStoredArray\(HISTORY_KEY|av_play_history|startContinue\(|updateContinue\(/
    const allowed = new Set([
      'features/player/utils/play-progress.ts',
      // 播放会话的进度事件在这里落地（桌面端由主窗口照它写，播放器窗口只转发）
      'features/player/progress/progress-events.ts',
      'features/player/mpv-session/mpv-session.ts',
      'features/player/composables/use-media-player.ts',
      'features/player/components/PlayerSession.vue',
      'features/player/continue/continue-store.ts',
      'features/online/components/DetailWindow.vue',
      'features/av/composables/use-av-playback.ts',
      'features/av/utils/av-playback.ts',
      // 搜索历史（online_search_history），不是播放历史
      'features/online/components/SearchTab.vue',
    ])
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap(name => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return walk(path)
        return /\.(ts|vue)$/.test(name) ? [path] : []
      })
    const hits = walk(RENDERER)
      .filter(path => writers.test(readFileSync(path, 'utf8')))
      .map(path => relative(RENDERER, path).split('\\').join('/'))
    expect(hits.filter(path => !allowed.has(path))).toEqual([])
  })
})

describe('侧栏', () => {
  it('页脚有无痕开关（按下态），打开时品牌旁显示标识', () => {
    const sidebar = read('features/shell/components/AppSidebar.vue')
    expect(sidebar).toContain('@click="toggleIncognito"')
    expect(sidebar).toMatch(/current="pressed"\s+:active="incognito"/)
    expect(sidebar).toContain('v-if="incognito" class="sidebar-incognito"')
    expect(sidebar).toContain('incognitoState()')
  })
})
