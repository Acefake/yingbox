/**
 * 等待反馈的分工（每种等待只用一种反馈，页面照这里选）：
 *
 * - 用户点了、在等结果 → 转圈（UiButton / UiIconButton 的 loading）。按钮忙时 aria-busy + aria-disabled，
 *   仍可聚焦，重复点击由 blockBusyClick 拦下；不用 disabled（焦点会丢到 body）。
 * - 后台在进行、不挡操作 → 三点（UiLoadingDots），放在内容后面，出现 / 消失不推动内容。
 * - 首屏等内容、知道内容长什么样 → 骨架（UiSkeleton），尺寸与真内容一致，到达时不跳。
 * - 知道总量 → 真实进度条（role=progressbar + aria-valuenow，如下载列表）。
 *
 * 已有内容时刷新 / 追加：保留旧内容直到新内容到达再整批替换，不清空、不换成骨架，
 * 用户的滚动位置因此不变。listWaiting 把这条规则写成一处。
 */

/**
 * 列表区等待时该怎么显示。
 * @param loading - 是否在加载
 * @param count - 当前已有的条数
 * @returns 'skeleton'：没有内容，显示骨架；'more'：已有内容，保留内容并给轻提示；null：不在等待
 */
export function listWaiting(
  loading: boolean,
  count: number
): 'skeleton' | 'more' | null {
  if (!loading) return null
  return count > 0 ? 'more' : 'skeleton'
}

/**
 * 按钮忙时拦下点击：阻止默认行为（type=submit 时不提交表单，回车隐式提交也是一次点击）、
 * 截断同一元素上后续的点击监听（Vue 把组件自身与父组件传入的 onClick 合成数组，
 * 组件自己的在前，stopImmediatePropagation 后数组里后面的不再执行）。
 */
export function blockBusyClick(busy: boolean, event: Event): void {
  if (!busy) return
  event.preventDefault()
  event.stopImmediatePropagation()
}
