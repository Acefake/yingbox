import { Modal } from 'ant-design-vue'

/**
 * 确认框：Ant 的 Modal.confirm，外观是 macOS 警告框（样式见 assets/styles/antd-overrides.css）。
 *
 * 参数和返回值与 Modal.confirm 完全一致；默认去掉图标、垂直居中、宽度 360，
 * 调用方显式传入 width / centered 时以调用方为准。
 */
export function confirmDialog(options: Parameters<typeof Modal.confirm>[0]) {
  return Modal.confirm({
    width: 360,
    centered: true,
    ...options,
    icon: null,
    wrapClassName: ['yb-confirm-dialog', options.wrapClassName]
      .filter(Boolean)
      .join(' '),
  })
}
