import { type VNodeChild, h, reactive, render } from 'vue'

import UiConfirmDialog from './UiConfirmDialog.vue'

/**
 * confirmDialog：macOS 警告框式的确认框，命令式调用，返回用户的选择。
 *
 * ```ts
 * if (await confirmDialog({ title: '删除这个数据源？', okText: '删除', danger: true })) remove()
 * ```
 *
 * - 结果：点确认（且 onOk 成功）→ true；点取消或按 Esc → false。
 * - onOk 可以是异步的：等待期间确认按钮转圈，两个按钮都不可点；
 *   onOk 抛错时对话框保持打开，把错误文字显示在按钮上方（用来做表单校验），用户改完可再点。
 * - content 可以是一段文字，也可以是渲染函数（放输入框等），渲染函数里的 ref 正常可用。
 * - 用原生 <dialog> 的 showModal：焦点自动困在框内、背景不可交互、Esc 取消；点遮罩不关闭（与系统警告框一致）。
 */
export interface ConfirmOptions {
  title: string
  /** 标题下的说明文字，或渲染函数 */
  content?: string | (() => VNodeChild)
  /** 确认按钮文字，默认「好」 */
  okText?: string
  /** 取消按钮文字，默认「取消」 */
  cancelText?: string
  /** 破坏性操作：确认按钮用危险色，默认焦点落在取消上 */
  danger?: boolean
  /** 宽度（px），默认 360；放表单时可加宽 */
  width?: number
  /** 点确认后执行；抛错则不关闭并显示错误 */
  onOk?: () => unknown
}

/** 一次确认的状态：组件只渲染它，流程在这里，便于脱离 DOM 测试 */
export interface ConfirmFlow {
  readonly state: { busy: boolean; settled: boolean; error: string }
  /** 点确认：执行 onOk，成功后以 true 结束 */
  ok: () => Promise<void>
  /** 点取消 / Esc：以 false 结束；onOk 进行中时忽略 */
  cancel: () => void
}

/** 建立确认流程；settle 只会被调用一次 */
export function createConfirmFlow(
  onOk: ConfirmOptions['onOk'],
  settle: (confirmed: boolean) => void
): ConfirmFlow {
  const state = reactive({ busy: false, settled: false, error: '' })
  const finish = (confirmed: boolean): void => {
    state.settled = true
    settle(confirmed)
  }
  return {
    state,
    async ok() {
      if (state.busy || state.settled) return
      state.busy = true
      state.error = ''
      try {
        await onOk?.()
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error)
        return
      } finally {
        state.busy = false
      }
      finish(true)
    },
    cancel() {
      if (state.busy || state.settled) return
      finish(false)
    },
  }
}

/** 关闭动画时长，与 UiConfirmDialog 的过渡一致 */
const CLOSE_DELAY = 160

/** 弹出确认框，见 {@link ConfirmOptions} */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const flow = createConfirmFlow(options.onOk, confirmed => {
      resolve(confirmed)
      // 先让对话框播完淡出，再卸载
      setTimeout(() => {
        render(null, container)
        container.remove()
      }, CLOSE_DELAY)
    })
    render(h(UiConfirmDialog, { options, flow }), container)
  })
}
