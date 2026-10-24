/**
 * 弹幕加载状态：记录当前条目是「加载中」还是「已加载完成」。
 * 只有成功才记为完成；失败清除记录，之后开关重新打开或凭据变化时可以重试。
 */

/** 加载状态记录 */
export interface LoadTracker {
  /** 这个条目要不要（重新）加载：已完成或正在加载时不用，force 时总是要 */
  needs: (key: string, force?: boolean) => boolean
  /** 开始加载 */
  start: (key: string) => void
  /** 加载成功：记为完成 */
  succeed: (key: string) => void
  /** 加载失败：清除记录，允许重试 */
  fail: (key: string) => void
  /** 换实例或拆下时清空 */
  reset: () => void
}

/** 创建加载状态记录（同一时间只跟踪一个条目） */
export function createLoadTracker(): LoadTracker {
  /** 正在加载或已加载完成的条目；空串表示没有 */
  let current = ''
  return {
    needs: (key, force = false) => force || key !== current,
    start: key => {
      current = key
    },
    // 完成后 current 保持不变，needs 对同一条目返回 false
    succeed: key => {
      current = key
    },
    fail: key => {
      if (key === current) current = ''
    },
    reset: () => {
      current = ''
    },
  }
}
