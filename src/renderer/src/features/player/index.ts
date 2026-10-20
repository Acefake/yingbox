/**
 * 播放器 feature 的公共出口：内置播放器组件、外部播放器（mpv / 独立窗口）调度、播放进度。
 * 其它 feature 只能从这里引用播放器。
 */
import { defineAsyncComponent } from 'vue'

/** 统一播放器组件（ArtPlayer + hls.js，体积大，首次渲染时才加载） */
export const UnifiedVideoPlayer = defineAsyncComponent(
  () => import('./components/UnifiedVideoPlayer.vue')
)
/** mpv 启动中的全局遮罩（应用根组件挂载） */
export { default as MpvLoadingOverlay } from './components/MpvLoadingOverlay.vue'
export {
  type PlayerSourceItem,
  canOpenElectronPlayer,
  openMediaPlayer,
  syncRtxVsr,
} from './composables/use-media-player'
export { useMpvPlayer } from './composables/use-mpv-player'
export { getMediaProgress } from './utils/play-progress'
