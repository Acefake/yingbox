import { describe, expect, it } from 'vitest'

import { hoverInfo } from '../src/renderer/src/features/player/skip/progress-hover'

describe('进度条悬停时间点', () => {
  it('按比例换算成时间并格式化', () => {
    expect(hoverInfo(0.5, 600, {})).toEqual({
      time: 300,
      label: '',
      text: '5:00',
    })
    expect(hoverInfo(0.75, 7200, {})?.text).toBe('1:30:00')
  })

  it('比例夹在 0–1，时长未知不显示', () => {
    expect(hoverInfo(1.2, 100, {})?.time).toBe(100)
    expect(hoverInfo(-0.1, 100, {})?.time).toBe(0)
    expect(hoverInfo(0.5, Number.NaN, {})).toBeNull()
    expect(hoverInfo(0.5, 0, {})).toBeNull()
  })

  it('落在片头 / 片尾区间里时带上段名', () => {
    const marks = { intro: { start: 10, end: 100 }, outro: 120 }
    expect(hoverInfo(50 / 1000, 1000, marks)?.text).toBe('0:50 · 片头')
    expect(hoverInfo(0.95, 1000, marks)?.label).toBe('片尾')
    expect(hoverInfo(0.5, 1000, marks)?.label).toBe('')
  })
})
