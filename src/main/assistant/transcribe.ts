/**
 * AI 助手的语音输入：渲染层录好的 16 kHz 单声道 WAV 写进临时目录，交给 AI 字幕同一套识别器
 * （本地 whisper.cpp 或云端转写接口，见「设置 → AI → 语音识别」），返回拼好的一句话。
 *
 * 私密模式的录音只交给本地识别：云端接口不是本机地址时一律拒绝（private_blocked），不看「私密板块只用本地模型」设置。
 * 临时目录用完即删；应用启动时再清扫一次上次崩溃 / 强杀留下的 yingbox-voice-* 目录。
 */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ASSISTANT_VOICE_MAX_SECONDS } from '../../shared/assistant'
import { speechRecognizer } from '../ai-subtitles'
import { transcriptText, wavSeconds } from './rules'

/** 单次转写超时（毫秒）：本地 whisper 首次加载模型较慢 */
const TRANSCRIBE_TIMEOUT_MS = 90_000
/** 录音临时目录的前缀 */
const VOICE_TEMP_PREFIX = 'yingbox-voice-'

/**
 * 转写一段录音。
 * @param audio WAV 字节（契约已限制大小）
 * @param isPrivate 当前是私密模式：只用本地识别
 */
export async function transcribeVoice(
  audio: Uint8Array,
  isPrivate: boolean
): Promise<string> {
  const seconds = wavSeconds(audio)
  if (seconds <= 0) throw new Error('录音格式不对：需要 16 位 PCM WAV')
  const recognize = speechRecognizer({
    private: isPrivate,
    localOnly: isPrivate,
  })
  const dir = await fs.mkdtemp(join(tmpdir(), VOICE_TEMP_PREFIX))
  try {
    const wav = join(dir, 'voice.wav')
    await fs.writeFile(wav, audio)
    const transcript = await recognize(
      wav,
      {
        index: 0,
        start: 0,
        duration: Math.min(seconds, ASSISTANT_VOICE_MAX_SECONDS),
      },
      {
        signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
        onProgress: () => {},
      }
    )
    return transcriptText(transcript.cues)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** 删掉临时目录里残留的录音目录（上次异常退出留下的）；失败静默 */
export async function sweepVoiceTemp(root = tmpdir()): Promise<void> {
  const names = await fs.readdir(root).catch(() => [] as string[])
  await Promise.all(
    names
      .filter(name => name.startsWith(VOICE_TEMP_PREFIX))
      .map(name =>
        fs
          .rm(join(root, name), { recursive: true, force: true })
          .catch(() => {})
      )
  )
}
