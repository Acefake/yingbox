/**
 * 影盒 UI 组件库。所有页面的按钮、图标、分段切换和海报都从这里取，
 * 保证风格一致；不要在页面里再手写同类控件。
 */
export { default as UiButton } from './UiButton.vue'
export { default as UiIcon } from './UiIcon.vue'
export { default as UiIconButton } from './UiIconButton.vue'
export { default as UiPosterCard } from './UiPosterCard.vue'
export { default as UiSegmented } from './UiSegmented.vue'
export type { SegmentedOption } from './UiSegmented.vue'
export { ICON_PATHS, type IconName } from './icons'
export { vTooltip } from './tooltip'
