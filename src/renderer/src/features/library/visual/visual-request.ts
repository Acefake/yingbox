/** 原生推理在途时允许其完成；已过期的排队请求不再启动编码或检索。 */
let tail = Promise.resolve()
export async function visualRequest<T>(
  live: () => boolean,
  run: () => Promise<T>
): Promise<T | null> {
  const previous = tail
  let release!: () => void
  tail = new Promise<void>(resolve => {
    release = resolve
  })
  await previous
  try {
    return live() ? await run() : null
  } finally {
    release()
  }
}
