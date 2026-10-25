/**
 * mpv 会话：openMediaPlayer 交给 mpv 播放后，跟着 mpv 推来的状态记进度、记看完、连播下一集。
 *
 * - 进度：每 2 秒记一次（媒体库条目上报片库，其余写本地进度表），「继续播放」记录跟着更新；mpv 退出时记最后的位置；
 * - 看完：停在结尾时记看完；有下一集且开着 player.autoNext 时在 mpv 画面上倒计时 5 秒再换下一集，
 *   倒计时中拖回进度或继续播就取消；没有下一集时显示载荷带的提示（如「没有下一集的文件」）；
 * - 同一时刻只跟一个会话：新开播（mpv 或内置播放器）就换掉。无痕模式不记（各写入函数自己判断）。
 * 判断规则在 mpv-session-rules.ts。
 */
import type { MpvStatus } from '@shared/mpv'

import { isIncognito } from '@/features/incognito'
import { getSetting } from '@/features/settings'

import { updateContinue } from '../continue/continue-store'
import {
  libraryResumeAt,
  reportLibraryProgress,
} from '../progress/library-sink'
import {
  getMediaProgress,
  mediaProgressKey,
  saveMediaProgress,
} from '../utils/play-progress'
import {
  type EndHint,
  type PlaylistEntry,
  playlistEntryLabel,
} from '../utils/play-queue'
import { markWatched } from '../watched'
import { MPV_NEXT_COUNTDOWN, mpvStep } from './mpv-session-rules'

/** 交给 mpv 的一次播放。 */
export interface MpvSessionInput {
  continueId: string
  playlist: PlaylistEntry[]
  index: number
  title: string
  endHint?: EndHint | null
  anime?: boolean
}

interface Session extends MpvSessionInput {
  finished: boolean
  lastSave: number
  position: number
  duration: number
  countdown: ReturnType<typeof setInterval> | null
}

let session: Session | null = null
let listening = false

const mpvApi = (): NonNullable<Window['api']>['mpv'] | undefined =>
  typeof window === 'undefined' ? undefined : window.api?.mpv

const label = (s: Session, i = s.index): string =>
  playlistEntryLabel(s.playlist[i], s.title)

const osd = (text: string, ms = 1200): void =>
  void mpvApi()
    ?.showText(text, ms)
    .catch(() => {})

/** 记一次进度（ended 为播到结尾）。 */
function save(s: Session, ended: boolean): void {
  const entry = s.playlist[s.index]
  if (!entry) return
  const { position, duration } = s
  if (!reportLibraryProgress(entry.library, position, duration, ended)) {
    const key = mediaProgressKey(entry)
    saveMediaProgress(key, ended ? 0 : position, duration)
    if (ended && key && !isIncognito()) markWatched(key)
  }
  updateContinue(s.continueId, {
    index: s.index,
    episode: s.playlist.length > 1 ? label(s) : undefined,
    progress: ended ? duration : position,
    duration,
    ended,
  })
  s.lastSave = Date.now()
}

function stopCountdown(s: Session): void {
  if (s.countdown) clearInterval(s.countdown)
  s.countdown = null
}

/** 在 mpv 里换到下一集。 */
async function playNext(s: Session): Promise<void> {
  const next = s.playlist[s.index + 1]
  if (!next || (!next.filePath && !next.url)) return
  s.index += 1
  s.finished = false
  s.position = 0
  s.duration = 0
  const startAt =
    libraryResumeAt(next.library) ?? getMediaProgress(mediaProgressKey(next))
  await mpvApi()
    ?.open({
      ...(next.filePath ? { filePath: next.filePath } : {}),
      ...(next.url ? { url: next.url } : {}),
      title: label(s),
      startAt,
      ...(s.anime ? { anime: true } : {}),
    })
    .catch(() => {})
}

/** 停在结尾：记看完，然后倒计时连播或显示提示。 */
function finish(s: Session): void {
  s.finished = true
  save(s, true)
  const next = s.playlist[s.index + 1]
  if (!next) {
    if (s.endHint) osd(s.endHint.text, 4000)
    return
  }
  if (!getSetting('player.autoNext')) return
  let left = MPV_NEXT_COUNTDOWN
  const name = label(s, s.index + 1)
  osd(`${left} 秒后播放下一集：${name}（拖回进度可取消）`)
  s.countdown = setInterval(() => {
    left -= 1
    if (session !== s) return stopCountdown(s)
    if (left > 0)
      return osd(`${left} 秒后播放下一集：${name}（拖回进度可取消）`)
    stopCountdown(s)
    void playNext(s)
  }, 1000)
}

function onStatus(status: MpvStatus): void {
  const s = session
  if (!s) return
  if (status.running && !status.loading && s.countdown === null) {
    if (typeof status.position === 'number') s.position = status.position
    if (typeof status.duration === 'number') s.duration = status.duration
  }
  const step = mpvStep(
    status,
    {
      finished: s.finished,
      counting: s.countdown !== null,
      lastSave: s.lastSave,
    },
    Date.now()
  )
  if (step.kind === 'stop') {
    if (!s.finished && s.position > 1) save(s, false)
    stopCountdown(s)
    session = null
    return
  }
  if (step.kind === 'cancel') {
    stopCountdown(s)
    osd('已取消自动播放下一集')
    return
  }
  if (step.kind === 'idle') return
  if (step.kind === 'finish') return finish(s)
  // 看完后又拖回去重看：下次停在结尾再算一次
  s.finished = false
  save(s, false)
}

/** 开始跟一个 mpv 会话（null 表示不再跟：改用内置播放器了）。 */
export function trackMpvSession(input: MpvSessionInput | null): void {
  if (session) stopCountdown(session)
  session = input
    ? {
        ...input,
        finished: false,
        lastSave: 0,
        position: 0,
        duration: 0,
        countdown: null,
      }
    : null
  const api = mpvApi()
  if (!input || listening || !api) return
  listening = true
  api.onStatus(onStatus)
}
