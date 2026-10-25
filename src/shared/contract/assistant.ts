import {
  ASSISTANT_VOICE_MAX_BYTES,
  type AssistantShortcutStatus,
} from '../assistant'
import { ContractError, bool, call, defineDomain, event } from './define'

/** 录音（16 kHz 单声道 WAV）：只收不超过上限的 Uint8Array */
function wavBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array))
    throw new ContractError('audio 必须是 Uint8Array')
  if (value.byteLength === 0 || value.byteLength > ASSISTANT_VOICE_MAX_BYTES)
    throw new ContractError('audio 大小超出范围')
  return value
}

/** AI 助手：全局快捷键状态与唤起事件、语音转写。 */
export const assistant = defineDomain(
  'assistant',
  {
    /** 全局快捷键的当前状态（设置页显示冲突提示用） */
    shortcutStatus: call<AssistantShortcutStatus>(),
    /** 取走「待唤起」：全局快捷键新建了窗口时，渲染层挂载后来取，为真就打开助手 */
    takeSummon: call<boolean>(),
    /**
     * 把一段录音转成文字（用「设置 → AI → 语音识别」的配置）；
     * isPrivate 为真时只用本地识别，非本地的转写接口一律拒绝（不看设置）。
     */
    transcribe: call<[audio: Uint8Array, isPrivate: boolean], string>(a => [
      wavBytes(a[0]),
      bool(a[1] ?? false, 'isPrivate'),
    ]),
  },
  {
    /** 按下了全局快捷键（主窗口已被唤到前台、渲染层已加载） */
    summon: event<null>(),
    /** 全局快捷键状态变化（设置改了、注册结果变了） */
    shortcutChanged: event<AssistantShortcutStatus>(),
  }
)
