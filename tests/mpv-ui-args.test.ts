import { describe, expect, it } from 'vitest'

import { spawnArgs } from '../src/main/mpv-props'

const base = { socket: 's', target: 't', headers: {}, vsr: false } as const

describe('mpv 启动参数：控制条', () => {
  it('有 uosc 目录时关掉自带 osc 并加载脚本与图标字体', () => {
    const args = spawnArgs({ ...base, uiDir: '/ui' })

    expect(args).toContain('--osc=no')
    expect(args).toContain('--osd-bar=no')
    expect(args.some(a => /^--script=.*uosc$/.test(a))).toBe(true)
    expect(args.some(a => a.startsWith('--osd-fonts-dir='))).toBe(true)
  })

  it('没有 uosc 时退回 mpv 自带 osc；非超分走 hwdec=auto-safe', () => {
    const args = spawnArgs({ ...base })

    expect(args).toContain('--osc=yes')
    expect(args).toContain('--hwdec=auto-safe')
  })
})
