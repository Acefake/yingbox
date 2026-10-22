/**
 * 键盘事件的共用判断：回车提交、Esc 关闭都要先让过输入法。
 *
 * 中文 / 日文输入法打开候选框（组字）时，回车是「把拼音或英文番号上屏」、Esc 是「取消组字」，
 * 这两下都属于输入法这一层，页面不能把它们当成提交或关闭。
 * - 组字中的 keydown：isComposing 为 true；
 * - 部分输入法 / 平台在 compositionend 之后才派发那次回车的 keydown，此时 isComposing 已是 false，
 *   但 keyCode 仍是 229（「输入法正在处理」），所以两者任一成立都算组字。
 */

/** 判断所需的最少字段（测试里可以直接传普通对象）。 */
export type KeyInput = Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>

/** 这次按键是否属于输入法组字。 */
export function isComposing(event: KeyInput): boolean {
  return event.isComposing || event.keyCode === 229
}

/** 可以当作「提交」的回车（输入法组字中的回车不算）。 */
export function isSubmitKey(event: KeyInput): boolean {
  return event.key === 'Enter' && !isComposing(event)
}

/** 按下的是 Esc（不管是否在组字；要当「关闭」用请用 isDismissKey）。 */
export function isEscapeKey(event: KeyInput): boolean {
  return event.key === 'Escape'
}

/** 可以当作「关闭」的 Esc（输入法组字中的 Esc 不算，它只取消组字）。 */
export function isDismissKey(event: KeyInput): boolean {
  return isEscapeKey(event) && !isComposing(event)
}
