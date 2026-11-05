import { beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ 'player.volume': 1, 'player.muted': false }))

vi.mock('@/features/settings', () => ({
  getSetting: (key: keyof typeof store) => store[key],
  setSetting: async (key: keyof typeof store, value: never) => {
    ;(store as Record<string, unknown>)[key] = value
  },
}))

import {
  rememberVolume,
  restoreVolume,
} from '../src/renderer/src/features/player/utils/volume-memory'

describe('播放器音量记忆', () => {
  beforeEach(() => {
    store['player.volume'] = 1
    store['player.muted'] = false
  })

  it('换集新建播放器时沿用上次的音量和静音，不回到 100%', () => {
    const first = { volume: 0.3, muted: true } as HTMLVideoElement

    rememberVolume(first)

    const next = { volume: 1, muted: false } as HTMLVideoElement

    restoreVolume(next)
    expect(next.volume).toBeCloseTo(0.3)
    expect(next.muted).toBe(true)
  })
})
