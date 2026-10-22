/**
 * 任务后继（followups）的声明：写在任务定义里（queue.register 的 followups），父任务结束后由队列统一派发，
 * 不再在处理函数里手写「跑完再排下一个」。媒体库的整条链：
 *
 *   扫描 / 重解析有变化 → 识别新条目（库开了自动识别）+ 指纹（扫描有新增 / 变化，网盘不排）
 *   识别有变化 → 演员自动查资料 + 按库设置写出 / 先整理再写出
 *   自动整理结束（成功或失败）→ 写出
 *
 * 派发规则（JobQueue.followUp / dispatch）：
 * - 成功派；失败看 when：'done'（缺省）不派，'settled' 在最终失败（不再重试）时也派，重试中不派；
 * - 父任务被取消、引擎退出都不派（处理函数吞掉中止正常返回也算取消）；
 * - 按 key（任务类型 + 目标）去重：同 key 已排队就合并进那一条，同 key 进行中最多再排一条。
 */
import type { JobSpec } from './job-store'

/** 一条后继：key 必填，用来去重。 */
export type FollowupSpec = JobSpec & { key: string }

/** 父任务结束时交给后继定义的信息。 */
export interface JobOutcome {
  payload: unknown
  /** 处理函数的返回值；失败时为 undefined。 */
  result: unknown
  failed: boolean
}

/** 一种任务的后继定义。 */
export interface FollowupRule {
  /** 'done'（缺省）只在成功后派；'settled' 成功或最终失败都派。 */
  when?: 'done' | 'settled'
  /** 算出要派发的后继（可异步，例如要先判定库在不在网盘上）。 */
  next: (
    outcome: JobOutcome
  ) => readonly FollowupSpec[] | Promise<readonly FollowupSpec[]>
}

/** 这次结束要不要派发。 */
export function shouldDispatch(
  rule: FollowupRule,
  failed: boolean,
  aborted: boolean
): boolean {
  if (aborted) return false
  return !failed || rule.when === 'settled'
}
