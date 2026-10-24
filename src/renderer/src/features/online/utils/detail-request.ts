/**
 * 别的页面请在线页打开某个条目的详情（追剧日历点在线剧的卡片）：
 * 调用方先跳到在线页，再 requestOnlineDetail；在线页监听 pendingOnlineDetail，取走后清空。
 */
import { type Ref, ref } from 'vue'

const pending = ref<unknown>(null)

/** 请在线页打开这个条目的详情（条目须可 JSON 序列化）。 */
export function requestOnlineDetail(item: unknown): void {
  pending.value = item ? JSON.parse(JSON.stringify(item)) : null
}

/** 待打开的条目（在线页读）。 */
export function pendingOnlineDetail(): Readonly<Ref<unknown>> {
  return pending
}

/** 取走待打开的条目。 */
export function takeOnlineDetail(): unknown {
  const item = pending.value
  pending.value = null
  return item
}
