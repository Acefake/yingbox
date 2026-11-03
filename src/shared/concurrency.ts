/**
 * 限并发映射：最多 limit 个任务同时进行，结果顺序与输入一致。
 * 在线搜索与 AV 聚合搜索共用（各站点请求逐个排队，避免一次打满几十个连接）。
 */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const output = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      output[index] = await mapper(items[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker)
  )
  return output
}
