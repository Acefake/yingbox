// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { artOptions } from '../src/renderer/src/features/player/utils/art-options'

const options = (url: string): ReturnType<typeof artOptions> =>
  artOptions({
    container: document.createElement('div'),
    url,
    autoplay: false,
    controls: true,
    hls: null,
  })

describe('播放器视频的 CORS 标记（画质增强要用 WebGL 读帧）', () => {
  it('本地文件与本机在线代理的视频标 crossOrigin，否则读帧抛 SecurityError', () => {
    expect(options('local://c/Videos/a.mp4').moreVideoAttr).toMatchObject({
      crossOrigin: 'anonymous',
    })
    expect(options('yingbox-stream://x/?u=abc').moreVideoAttr).toMatchObject({
      crossOrigin: 'anonymous',
    })
  })

  it('第三方站点的视频不标：对方没有 CORS 头，标了会直接播不出来', () => {
    expect(
      options('https://cdn.example.com/a.m3u8').moreVideoAttr
    ).not.toHaveProperty('crossOrigin')
    expect(options('/media/a.mp4').moreVideoAttr).not.toHaveProperty(
      'crossOrigin'
    )
  })
})
