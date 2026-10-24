import { describe, expect, it } from 'vitest'
import { assertPrivacy, resolveAiConfig } from '../src/main/ai/config'
import { AiError } from '../src/main/ai/errors'
import { resolveAiEndpoint } from '../src/shared/ai/providers'

/**
 * resolveAiEndpoint / resolveAiConfig 的本地判定回归：只看最终生效的接口地址，
 * 不按服务商名称放行（Ollama 填公网地址就是云端，私密限制必须生效）。
 */

describe('AI 接口本地判定只看最终地址', () => {
  it('Ollama 填公网地址不算本地，私密内容被拦截', () => {
    const values = {
      provider: 'ollama' as const,
      baseUrl: 'https://public.example/v1',
      model: 'qwen',
    }
    expect(resolveAiEndpoint(values).local).toBe(false)
    const config = resolveAiConfig(values, () => '')
    expect(config.local).toBe(false)
    expect(() => assertPrivacy(config, true, true)).toThrowError(AiError)
  })

  it('Ollama 默认地址与 127.0.0.1 / localhost 仍算本地', () => {
    for (const baseUrl of [
      '',
      'http://127.0.0.1:11434/v1',
      'http://localhost:11434/v1/',
    ]) {
      const values = { provider: 'ollama' as const, baseUrl, model: '' }
      expect(resolveAiEndpoint(values).local).toBe(true)
      const config = resolveAiConfig(values, () => '')
      expect(config.local).toBe(true)
      expect(() => assertPrivacy(config, true, true)).not.toThrow()
    }
  })
})
