import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RecapProbe } from '../src/shared/recap/types'
import {
  isAbortError,
  recapAiReady,
  recapErrorText,
  shouldOfferRecap,
  stripIpcPrefix,
} from '../src/renderer/src/features/player/recap/recap-rules'

/**
 * 播放器里的前情提要 / 问剧情纯规则：提示卡何时浮出、AI 是否已配置、错误文案；以及接入方式。
 * test-affected: repo-wide（最后一组读源码断言接入方式）
 */

describe('提示卡与错误规则', () => {
  const probe: RecapProbe = {
    show: 'S',
    episode: { label: 'S01E02', episode: 2, season: 1 },
    previous: [{ label: 'S01E01', episode: 1, season: 1 }],
    cacheKey: 'recap:0000000000000000',
    cached: null,
  }
  const offer = (
    patch: Partial<Parameters<typeof shouldOfferRecap>[0]>
  ): boolean =>
    shouldOfferRecap({
      enabled: true,
      aiReady: true,
      probe,
      startAt: 0,
      ...patch,
    })

  it('第 2 集起、从头播、设置打开、AI 已配置、之前有素材才提示', () => {
    expect(offer({})).toBe(true)
    expect(offer({ enabled: false })).toBe(false)
    expect(offer({ aiReady: false })).toBe(false)
    expect(offer({ startAt: 300 })).toBe(false)
    expect(offer({ probe: { ...probe, previous: [] } })).toBe(false)
    expect(offer({ probe: { ...probe, episode: null } })).toBe(false)
  })

  it('AI 是否已配置：预设地址 / 模型兜底，需要 Key 的服务商要有 Key', () => {
    const base = { baseUrl: '', model: '', keySaved: false }
    expect(recapAiReady({ ...base, provider: 'deepseek' })).toBe(false)
    expect(
      recapAiReady({ ...base, provider: 'deepseek', keySaved: true })
    ).toBe(true)
    expect(recapAiReady({ ...base, provider: 'ollama' })).toBe(true)
    expect(recapAiReady({ ...base, provider: 'custom' })).toBe(false)
    expect(
      recapAiReady({
        provider: 'custom',
        baseUrl: 'http://127.0.0.1:8080/v1',
        model: 'qwen',
        keySaved: false,
      })
    ).toBe(true)
  })

  it('错误文案：未配置 / 私密 / 去掉 IPC 外壳；AbortError 识别', () => {
    expect(recapErrorText({ code: 'not_configured', message: '' })).toContain(
      '设置 → AI'
    )
    expect(recapErrorText({ code: 'private_blocked', message: '' })).toContain(
      '本地'
    )
    expect(
      stripIpcPrefix(
        "Error invoking remote method 'recap:prepare': Error: 前情提要只支持本地视频文件"
      )
    ).toBe('前情提要只支持本地视频文件')
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
  })
})

describe('接入方式（源码断言）', () => {
  it('UnifiedVideoPlayer 只放一个 RecapLayer', () => {
    const player = readFileSync(
      join(
        __dirname,
        '..',
        'src/renderer/src/features/player/components/UnifiedVideoPlayer.vue'
      ),
      'utf8'
    )
    expect(player.match(/<RecapLayer\b/g)).toHaveLength(1)
  })
})
