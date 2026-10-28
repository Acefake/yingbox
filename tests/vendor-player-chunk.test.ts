/**
 * 播放器运行时单独成块：Artplayer、hls.js、弹幕插件，其它包不动。
 */
import { describe, expect, it } from 'vitest'
import { vendorPlayerManualChunk } from '../scripts/vendor-player-chunk'

describe('vendorPlayerManualChunk', () => {
  it('把三个播放器包分到 vendor-player', () => {
    expect(
      vendorPlayerManualChunk(
        '/workspace/node_modules/.pnpm/artplayer@5.4.0/node_modules/artplayer/dist/artplayer.mjs'
      )
    ).toBe('vendor-player')
    expect(
      vendorPlayerManualChunk(
        '/workspace/node_modules/.pnpm/hls.js@1.6.16/node_modules/hls.js/dist/hls.mjs'
      )
    ).toBe('vendor-player')
    expect(
      vendorPlayerManualChunk(
        '/workspace/node_modules/.pnpm/artplayer-plugin-danmuku@5.3.0/node_modules/artplayer-plugin-danmuku/dist/artplayer-plugin-danmuku.mjs'
      )
    ).toBe('vendor-player')
  })

  it('不把 vue 或业务源码划进去', () => {
    expect(
      vendorPlayerManualChunk(
        '/workspace/node_modules/.pnpm/vue@3.5.17/node_modules/vue/dist/vue.runtime.esm-bundler.js'
      )
    ).toBeUndefined()
    expect(
      vendorPlayerManualChunk(
        '/workspace/src/renderer/src/features/player/utils/art-core.ts'
      )
    ).toBeUndefined()
    expect(
      vendorPlayerManualChunk(
        '/workspace/node_modules/.pnpm/artplayer-plugin-danmuku@5.3.0/node_modules/artplayer/dist/artplayer.mjs'
      )
    ).toBe('vendor-player')
  })
})
