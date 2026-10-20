/**
 * 影盒 UI 组件库。所有页面的按钮、导航项、列表行、芯片、图标、分段切换和海报都从这里取，
 * 保证风格一致；页面里不要再手写原生 <button>（需要无样式的可点区域时用 UiPressable）。
 */
export { default as UiButton } from './UiButton.vue'
export { default as UiChip } from './UiChip.vue'
export { default as UiIcon } from './UiIcon.vue'
export { default as UiIconButton } from './UiIconButton.vue'
export { default as UiListRow } from './UiListRow.vue'
export { default as UiNavItem } from './UiNavItem.vue'
export { default as UiPosterCard } from './UiPosterCard.vue'
export { default as UiPressable } from './UiPressable.vue'
export { default as UiSegmented } from './UiSegmented.vue'
export type { SegmentedOption } from './UiSegmented.vue'
export { ICON_PATHS, type IconName } from './icons'
export { vTooltip } from './tooltip'
