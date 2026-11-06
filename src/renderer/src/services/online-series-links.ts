/**
 * 在线播放记录 ↔ 网盘追剧任务的对应（ADR-0052）：用户主动追剧后，本次运行记下「记录 id → 任务句柄」。
 * 不落盘（设置项要登记在共享 schema，这里不值得）：重启后靠剧名对应（{@link sameTitle}），对不上时再点「追更」，
 * 建条目是幂等的，会回到同一部剧。
 */
import { type ShallowRef, shallowRef } from 'vue'

const links = shallowRef<ReadonlyMap<string, number>>(new Map())

/** 记录 id → 片库剧 id（响应式，整张表替换） */
export const onlineLinks: Readonly<ShallowRef<ReadonlyMap<string, number>>> =
  links

/** 记下一条对应 */
export function linkOnline(recordId: string, seriesId: number): void {
  links.value = new Map(links.value).set(recordId, seriesId)
}

const normalize = (title: string): string =>
  title.replace(/\s+/g, '').toLowerCase()

/** 两个剧名是同一个（忽略空白与大小写，不能为空） */
export function sameTitle(a: string, b: string): boolean {
  const left = normalize(a)
  return left !== '' && left === normalize(b)
}
