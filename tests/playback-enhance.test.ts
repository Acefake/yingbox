import { describe, expect, it } from 'vitest'
import { enhanceProps, paramsAreSdr } from '../src/main/mpv-enhance'
import {
  COPY_FRAGMENT,
  FSR_EASU_FRAGMENT,
  FSR_RCAS_FRAGMENT,
  casMpvShader,
  enhanceSharpness,
  isSdrColor,
  rcasStrength,
  shouldEnhance,
} from '../src/shared/playback/enhance'

describe('画质增强', () => {
  it('档位越高锐化越强，关闭为 0', () => {
    expect(enhanceSharpness('off')).toBe(0)
    expect(enhanceSharpness('soft')).toBeLessThan(enhanceSharpness('strong'))
  })

  it('只在确认 SDR 时启用', () => {
    const size = { w: 1280, h: 720 }
    const base = {
      level: 'standard' as const,
      sdr: true,
      source: size,
      display: size,
    }
    expect(shouldEnhance(base)).toBe(true)
    expect(shouldEnhance({ ...base, sdr: false })).toBe(false)
    expect(shouldEnhance({ ...base, level: 'off' })).toBe(false)
    expect(shouldEnhance({ ...base, source: null })).toBe(false)
  })

  it('HDR、杜比视界和未知色彩不算 SDR', () => {
    expect(isSdrColor('bt.1886', 'bt.709')).toBe(true)
    expect(isSdrColor('pq', 'bt.2020')).toBe(false)
    expect(paramsAreSdr({ gamma: 'bt.1886', primaries: 'bt.709' })).toBe(true)
    expect(
      paramsAreSdr({
        gamma: 'bt.1886',
        primaries: 'bt.709',
        colormatrix: 'dolbyvision',
      })
    ).toBe(false)
    expect(paramsAreSdr(null)).toBe(false)
  })

  it('mpv 属性：HDR 或关闭时恢复基础缩放并清空着色器', () => {
    expect(enhanceProps('standard', true, '/a.glsl', 'lanczos')).toEqual([
      ['scale', 'ewa_lanczossharp'],
      ['deband', true],
      ['glsl-shaders', ['/a.glsl']],
    ])
    expect(enhanceProps('standard', false, '/a.glsl', 'lanczos')).toEqual([
      ['scale', 'lanczos'],
      ['deband', false],
      ['glsl-shaders', []],
    ])
    expect(enhanceProps('off', true, null, 'ewa_lanczossharp')[0]).toEqual([
      'scale',
      'ewa_lanczossharp',
    ])
  })

  it('着色器带入对应强度', () => {
    expect(casMpvShader('strong')).toContain('//!HOOK OUTPUT')
    expect(casMpvShader('strong')).toContain('0.800')
  })

  it('网页播放器用 FSR 1.0：档位越高 RCAS 越锐，着色器是完整可编译的 GLSL 入口', () => {
    expect(rcasStrength('soft')).toBeLessThan(rcasStrength('standard'))
    expect(rcasStrength('standard')).toBeLessThan(rcasStrength('strong'))
    expect(rcasStrength('strong')).toBeLessThanOrEqual(1)
    for (const source of [
      FSR_EASU_FRAGMENT,
      FSR_RCAS_FRAGMENT,
      COPY_FRAGMENT,
    ]) {
      expect(source).toContain('void main()')
      expect(source).toContain('gl_FragColor')
    }
    expect(FSR_EASU_FRAGMENT).toContain('uSrc')
    expect(FSR_RCAS_FRAGMENT).toContain('uStrength')
  })
})
