/**
 * AI 助手的语音输入：渲染层录好的 16 kHz 单声道 WAV 写进临时目录，交给 AI 字幕同一套识别器
 * （本地 whisper.cpp 或云端转写接口，见「设置 → AI → 语音识别」），返回拼好的一句话。
 */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ASSISTANT_VOICE_MAX_SECONDS } from '../../shared/assistant'
import { speechRecognizer } from '../ai-subtitles'
import { transcriptText, wavSeconds } from './rules'

/** 单次转写超时（毫秒）：本地 whisper 首次加载模型较慢 */
const TRANSCRIBE_TIMEOUT_MS = 90_000

/**
 * 转写一段录音。
 * @param audio WAV 字节（契约已限制大小）
 * @param isPrivate 当前在私密板块
 */
export async function transcribeVoice(
  audio: Uint8Array,
  isPrivate: boolean
): Promise<string> {
  const seconds = wavSeconds(audio)
  if (seconds <= 0) throw new Error('录音格式不对：需要 16 位 PCM WAV')
  const recognize = speechRecognizer({ private: isPrivate })
  const dir = await fs.mkdtemp(join(tmpdir(), 'yingbox-voice-'))
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
