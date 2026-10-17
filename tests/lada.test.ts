import { describe, expect, it } from 'vitest'
import { parseLadaLine, restoredPathFor } from '../src/shared/lada'

describe('parseLadaLine', () => {
  it('parses a real tqdm progress line', () => {
    const line =
      '正在处理视频:  99%|██████████|已处理 00:25 (893帧) | 剩余： 0:00 (10帧) | 速度：35.4 帧/秒'
    const parsed = parseLadaLine(line)
    expect(parsed.percent).toBe(99)
    expect(parsed.fps).toBeCloseTo(35.4)
    expect(parsed.frames).toBe(893)
    expect(parsed.message).toBeTruthy()
    // 进度条图形被剥掉，只留可读文字
    expect(parsed.message).not.toContain('█')
    expect(parsed.message).toContain('已处理')
  })

  it('handles carriage returns (tqdm redraws the same line)', () => {
    expect(parseLadaLine('\r正在处理视频:  42%|██|已处理 00:10 (300帧)\r').percent).toBe(42)
  })

  it('accepts a half-width colon before the speed', () => {
    expect(parseLadaLine('已处理 00:10 (300帧) | 速度: 12.5 帧/秒').fps).toBeCloseTo(12.5)
  })

  it('parses the audio-merge line as a message without numbers', () => {
    const parsed = parseLadaLine('正在合并音频')
    expect(parsed.percent).toBeUndefined()
    expect(parsed.fps).toBeUndefined()
    expect(parsed.message).toBe('正在合并音频')
  })

  it('ignores empty lines and out-of-range percentages', () => {
    expect(parseLadaLine('   ')).toEqual({})
    expect(parseLadaLine('完成 999%').percent).toBeUndefined()
    expect(parseLadaLine('0%').percent).toBe(0)
  })
})

describe('restoredPathFor', () => {
  it('inserts .restored before the extension', () => {
    expect(restoredPathFor('E:\\root\\高跟\\a.mp4')).toBe('E:\\root\\高跟\\a.restored.mp4')
    expect(restoredPathFor('/home/u/a.mkv')).toBe('/home/u/a.restored.mkv')
  })

  it('keeps earlier dots in the name', () => {
    expect(restoredPathFor('C:\\v\\a.b.c.mp4')).toBe('C:\\v\\a.b.c.restored.mp4')
  })

  it('falls back to .mp4 when there is no extension', () => {
    expect(restoredPathFor('C:\\v\\movie')).toBe('C:\\v\\movie.restored.mp4')
  })

  it('does not treat a dot in a directory name as an extension', () => {
    expect(restoredPathFor('C:\\my.folder\\movie')).toBe('C:\\my.folder\\movie.restored.mp4')
  })
})
