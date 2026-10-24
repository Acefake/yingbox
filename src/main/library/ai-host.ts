/**
 * 主进程替媒体库引擎代办的 AI 调用（引擎侧见 engine/host-calls.ts）：
 * 引擎里的 AI 识别兜底要问大模型，而服务商配置、API Key（safeStorage）与用量统计都在主进程的 aiService。
 *
 * - aiStatus：AI 是否可用（接口地址 / 模型 / Key 齐全）与设置「AI 识别兜底」是否打开；
 * - aiChatJson：转给 aiService().chatJson，只回解析后的 JSON。私密检查、重试、用量记账都在 aiService 里。
 */
import type { AiJsonRequest } from '../../shared/ai/types'
import { aiService } from '../ai'
import { assertUsable } from '../ai/config'
import { settingsStore } from '../settings'
import { LIBRARY_HOST_METHODS } from './engine/host-calls'
import type { LibraryAiStatus } from './identify/ai/ai-scrape-rules'

/** AI 是否可用：aiService 还没初始化或配置不全都算不可用。 */
function aiConfigured(): boolean {
  try {
    const config = aiService().config()
    assertUsable(config)
    return true
  } catch {
    return false
  }
}

/** 媒体库引擎的代办方法表（交给 UtilityHost 的 host 选项）。 */
export function libraryAiHost(): Record<
  string,
  (...args: never[]) => Promise<unknown>
> {
  return {
    [LIBRARY_HOST_METHODS.aiStatus]: async (): Promise<LibraryAiStatus> => ({
      configured: aiConfigured(),
      fallback: settingsStore().get('ai.scrapeFallback'),
    }),
    [LIBRARY_HOST_METHODS.aiChatJson]: async (request: AiJsonRequest) => {
      if (!request || typeof request !== 'object' || !request.messages)
        throw new Error('AI 请求格式不对')
      return (await aiService().chatJson(request)).data
    },
  }
}
