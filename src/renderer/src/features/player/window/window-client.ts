/**
 * 播放器窗口这一侧的往来（主进程 src/main/player-window 转发）：
 * - 收：页面就绪时取走等着的载荷，之后的换片走 play 事件；主窗口的遥控请求就地执行（remote/player-remote）并回执；
 * - 发：进度事件一律转给主窗口写（progress/progress-events 的 relayProgress）；在播状态（片名、私密、能否遥控、
 *   问剧情、播到哪）在遥控目标变化时、播放中每 2 秒报一次，主窗口的 AI 助手与侧栏搜索据此判断。
 */
import type { PlayerWindowState } from '../../../../../shared/player-window'
import type { ProgressEvent } from '../progress/progress-events'
import { relayProgress } from '../progress/progress-events'
import {
  type PlayerRemoteCommand,
  askLocalPlot,
  localRemote,
  onRemoteChange,
  runLocalCommand,
} from '../remote/player-remote'
import type { PlayerPayload } from '../utils/play-queue'

/** 播放中多久报一次在播状态（播到哪） */
const STATE_INTERVAL_MS = 2000

/** connectPlayerWindow 的输入 */
export interface PlayerWindowClient {
  /** 播放一份载荷（换片） */
  play: (payload: PlayerPayload) => void
  /** 当前会话来自私密板块（实例还没建好时也要报私密） */
  privateSession: () => boolean
  /** 当前条目名（实例还没建好时用） */
  title: () => string
}

/**
 * 接上主进程；返回断开函数。
 * @param client 播放器窗口根组件给的回调
 */
export function connectPlayerWindow(client: PlayerWindowClient): () => void {
  const api = window.api?.playerWindow
  if (!api) return () => {}

  const restoreProgress = relayProgress((event: ProgressEvent) => {
    void api.progress(event).catch(() => {})
  })

  let last = ''
  const report = (): void => {
    const local = localRemote()
    const state: PlayerWindowState = {
      title: local.title || client.title(),
      private: client.privateSession() || local.private,
      controllable: local.controllable,
      plotQa: local.plotQa,
      seconds: local.seconds,
    }
    const key = JSON.stringify(state)
    if (key === last) return
    last = key
    void api.state(state).catch(() => {})
  }
  const stopWatching = onRemoteChange(report)
  const timer = window.setInterval(report, STATE_INTERVAL_MS)

  api.onPlay(payload => {
    client.play(payload as PlayerPayload)
    report()
  })
  api.onRemote(({ id, request }) => {
    const reply =
      request.kind === 'ask'
        ? { ok: askLocalPlot(request.question), text: '' }
        : runLocalCommand(request.command as unknown as PlayerRemoteCommand)
    void api.reply(id, reply).catch(() => {})
  })
  void api.ready().then(payload => {
    if (payload) client.play(payload as PlayerPayload)
    report()
  })

  return () => {
    restoreProgress()
    stopWatching()
    window.clearInterval(timer)
    api.offPlay()
    api.offRemote()
  }
}
