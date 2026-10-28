// @vitest-environment jsdom
/**
 * 续播进度改经 @/utils/storage 后，键（media_play_progress）与格式不变：老数据照常读出，写回原键。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  getMediaProgress,
  readMediaProgress,
  saveMediaProgress,
} from '../src/renderer/src/features/player/utils/play-progress'

const KEY = 'media_play_progress'

beforeEach(() => localStorage.clear())

describe('续播进度存储', () => {
  it('丢弃坏条目并继续保存有效进度', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        bad: null,
        wrong: { progress: 'x' },
        good: { progress: 1, duration: 5, updatedAt: 1 },
      })
    )
    expect(() => saveMediaProgress('new', 2, 5)).not.toThrow()
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      good: { progress: 1, duration: 5, updatedAt: 1 },
      new: { progress: 2, duration: 5, updatedAt: expect.any(Number) },
    })
  })
  it('升级前写下的进度照常读出', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        'https://a/1.m3u8': { progress: 120, duration: 3600, updatedAt: 5 },
      })
    )
    expect(getMediaProgress('https://a/1.m3u8')).toBe(120)
    expect(readMediaProgress('https://a/1.m3u8')).toMatchObject({
      progress: 120,
      duration: 3600,
      finished: false,
      updatedAt: 5,
    })
  })

  it('写回原键，和老数据合并', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ old: { progress: 1, duration: 2, updatedAt: 1 } })
    )
    saveMediaProgress('/video/a.mkv', 42, 100)
    const map = JSON.parse(localStorage.getItem(KEY) || '{}')
    expect(map.old.progress).toBe(1)
    expect(map['/video/a.mkv']).toMatchObject({ progress: 42, duration: 100 })
  })

  it('坏数据当作空表', () => {
    localStorage.setItem(KEY, '{bad')
    expect(getMediaProgress('x')).toBe(0)
    expect(readMediaProgress('x')).toBeNull()
  })

  it('源码不再直接用 localStorage', () => {
    const source = readFileSync(
      resolve(
        __dirname,
        '../src/renderer/src/features/player/utils/play-progress.ts'
      ),
      'utf8'
    )
    expect(source).not.toMatch(/\blocalStorage\b/)
    expect(source).toContain("from '@/utils/storage'")
  })
})
