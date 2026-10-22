/**
 * 卡片悬停预览：卡片给一个 PreviewSource，悬停延时后在卡内静音循环播放，全局同一时刻只播一张。
 * 详见 controller.ts（规则）、stage.ts（播放与释放）、bind.ts（事件）、use-hover-preview.ts（Vue）。
 */
export type { PreviewMedia, PreviewSettings, PreviewSource } from './types'
export { DEFAULT_PREVIEW_SETTINGS } from './types'
export {
  configureHoverPreview,
  stopHoverPreview,
  useCardPreview,
  useGridPreview,
} from './use-hover-preview'
