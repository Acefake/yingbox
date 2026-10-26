/**
 * 影盒 UI 组件库。所有页面的按钮、导航项、列表行、芯片、图标、分段切换和海报都从这里取，
 * 保证风格一致；页面里不要再手写原生 <button>（需要无样式的可点区域时用 UiPressable），
 * 也不要手写 <input> / <select> / <textarea>（用 UiInput / UiSelect / UiTextarea /
 * UiSwitch / UiCheckbox / UiRadio；文件、滑块、隐藏字段除外）。
 * 轻提示用 toast，确认用 confirmDialog（都是命令式，不用在模板里放组件）。
 * 等待反馈的分工（转圈 / 三点 / 骨架 / 进度条）见 feedback.ts。
 */
export { default as UiButton } from './UiButton.vue'
export { confirmDialog, type ConfirmOptions } from './confirm'
export { default as UiCheckbox } from './UiCheckbox.vue'
export { default as UiChip } from './UiChip.vue'
export { default as UiEpisodeCard } from './UiEpisodeCard.vue'
export { default as UiIcon } from './UiIcon.vue'
export { default as UiIconButton } from './UiIconButton.vue'
export { default as UiInput } from './UiInput.vue'
export { default as UiListRow } from './UiListRow.vue'
export { default as UiLoadingDots } from './UiLoadingDots.vue'
export { default as UiMediaRow } from './UiMediaRow.vue'
export { default as UiMenuButton } from './UiMenuButton.vue'
export type { MenuButtonItem } from './UiMenuButton.vue'
export { default as UiNavItem } from './UiNavItem.vue'
export { default as UiPosterCard } from './UiPosterCard.vue'
export { default as UiPressable } from './UiPressable.vue'
export { default as UiRadio } from './UiRadio.vue'
export { default as UiSectionHeader } from './UiSectionHeader.vue'
export { default as UiSegmented } from './UiSegmented.vue'
export type { SegmentedOption } from './UiSegmented.vue'
export { default as UiSelect } from './UiSelect.vue'
export type { SelectOption } from './UiSelect.vue'
export { default as UiShelf } from './UiShelf.vue'
export { default as UiSkeleton } from './UiSkeleton.vue'
export { default as UiSpecBadge } from './UiSpecBadge.vue'
export {
  type SpecBadge,
  type SpecVariant,
  mediaSpecs,
  releaseSpecs,
  videoProbeSpec,
  videoRangeSpec,
} from './spec-badge'
export { default as UiSwitch } from './UiSwitch.vue'
export { default as UiTextarea } from './UiTextarea.vue'
export {
  toast,
  type ToastDismiss,
  type ToastKind,
  type ToastOptions,
} from './toast'
export type { IconName } from './icons'
export { vTooltip } from './tooltip'
export { default as UiVirtualGrid } from './UiVirtualGrid.vue'
