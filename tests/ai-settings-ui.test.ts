import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { defaultValues } from '../src/shared/settings/schema'

/**
 * 设置 · AI：服务商下拉能选到 OpenCode Go，选中后接口地址 / 模型占位用预设、
 * 模型说明写明只支持 Chat Completions 兼容模型，Key 状态按 ai.apiKey.opencode-go 显示。
 * window.api.settings 用替身（快照决定当前服务商与密钥状态）。
 */
function stubBridge(
  values: Record<string, unknown>,
  secrets: Record<string, boolean> = {}
): void {
  vi.stubGlobal('window', {
    api: {
      settings: {
        snapshot: () => ({
          values: { ...defaultValues(), ...values },
          secrets,
          legacyMigrated: true,
        }),
        migrateLegacy: () => {
          throw new Error('不应迁移')
        },
        onChanged: () => {},
        onSecretChanged: () => {},
        set: vi.fn(async () => {}),
      },
    },
  })
}

const render = async (): Promise<string> => {
  const { default: AiSettings } =
    await import('../src/renderer/src/features/settings/sections/AiSettings.vue')
  return renderToString(h(AiSettings))
}

beforeEach(() => {
  vi.resetModules()
})

describe('AI 设置 · OpenCode Go', () => {
  it('服务商下拉里有 OpenCode Go', async () => {
    stubBridge({})
    const html = await render()
    expect(html).toMatch(
      /<option value="opencode-go"[^>]*>OpenCode Go<\/option>/
    )
  })

  it('选中后：预设地址 / 模型作占位，说明只支持 Chat Completions 模型，Key 已保存', async () => {
    stubBridge(
      { 'ai.provider': 'opencode-go' },
      { 'ai.apiKey.opencode-go': true }
    )
    const html = await render()
    expect(html).toContain(
      'placeholder="https://opencode.ai/inference/go/openai/v1"'
    )
    expect(html).toContain('placeholder="glm-5.3-flash"')
    expect(html).toContain('Chat Completions')
    expect(html).toContain('已加密保存在系统钥匙串')
  })
})
