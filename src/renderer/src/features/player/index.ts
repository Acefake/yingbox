/**
 * 播放器 feature 的公共出口：内置播放器（桌面端独立窗口 / 网页端播放层）、mpv 的调度、播放进度。
 * 其它 feature 只能从这里引用播放器；播放一律经 openMediaPlayer。
 */
/** 网页端盖在页面上的播放层（应用根组件挂载一次；桌面端不出现） */
export { default as PlayerModal } from './modal/PlayerModal.vue'
/** 独立播放器窗口的根组件（player.html 的入口挂载） */
export { default as PlayerWindowApp } from './window/PlayerWindowApp.vue'
/** 当前播放会话、关闭播放器；主窗口启动时接上播放器窗口的回写 */
export {
  type PlayerNowPlaying,
  type PlayerRemoteState,
  type PlayerSessionInfo,
  askPlotQuestion,
  closePlayer,
  installPlayerHost,
  playerNowPlaying,
  playerRemoteState,
  playerSession,
  runPlayerCommand,
} from './host/player-host'
/** 统一播放器组件（直播页直接内嵌，不经播放器窗口） */
export { default as UnifiedVideoPlayer } from './components/UnifiedVideoPlayer.vue'
/** mpv 启动中的全局遮罩（应用根组件挂载） */
export { default as MpvLoadingOverlay } from './components/MpvLoadingOverlay.vue'
export {
  type PlayerSourceItem,
  openMediaPlayer,
  syncRtxVsr,
} from './composables/use-media-player'
export { useMpvPlayer } from './composables/use-mpv-player'
export { getMediaProgress, readMediaProgress } from './utils/play-progress'
/** mpv 播放信息行（设置 · 播放器里显示） */
export { mpvInfoRows } from './playback-info/info-rules'
/** 「已看完」集合（看完一集时记录，独立于进度表） */
export { isWatched, markWatched, unmarkWatched } from './watched'
export { syncAnime4k } from './anime4k/anime4k-sync'
/** 「继续播放」：各板块顶部的横排卡片与记录 */
export { default as ContinueRow } from './continue/ContinueRow.vue'
export {
  continueRecords,
  mergeContinue,
  onContinueFinished,
} from './continue/continue-store'
/** 媒体库条目的进度去向（媒体库 feature 启动时接上片库） */
export {
  type LibraryProgressSink,
  type LibraryRef,
  setLibraryProgressSink,
} from './progress/library-sink'
export type { EndHint } from './utils/play-queue'
export type {
  ContinueMeta,
  ContinueRecord,
  ContinueSection,
} from './continue/continue-rules'
/** 自动检测片头片尾（媒体库剧集详情的「检测片头片尾」） */
export {
  cancelDetect,
  detectProgressOf,
  detectSeason,
  introDetectStatus,
  introDetectSupported,
  skipKeyOf,
} from './skip/intro-detect'
export { metaOf, replayOptions } from './continue/continue-rules'
export { progressRatio } from './continue/continue-rules'
/** 遥控当前播放（AI 助手，经上面的 runPlayerCommand / askPlotQuestion）：命令与回执的形状 */
export type {
  PlayerRemoteCommand,
  PlayerRemoteResult,
} from './remote/player-remote'
export { SLEEP_CHOICES, type SleepChoice } from './sleep/sleep-rules'
