/**
 * 播放器 feature 的公共出口：应用内播放弹窗与小窗、mpv 的调度、播放进度。
 * 其它 feature 只能从这里引用播放器；播放一律经 openMediaPlayer。
 */
/** 应用内播放弹窗与角落小窗（应用根组件各挂载一次） */
export { default as PlayerModal } from './modal/PlayerModal.vue'
export { default as MiniPlayer } from './mini/MiniPlayer.vue'
export { closePlayerModal, playerModal } from './modal/player-modal'
/** 统一播放器组件（直播页直接内嵌，不经播放弹窗） */
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
export { continueRecords, onContinueFinished } from './continue/continue-store'
export type {
  ContinueMeta,
  ContinueRecord,
  ContinueSection,
} from './continue/continue-rules'
