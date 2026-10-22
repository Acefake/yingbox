/**
 * 容器健康检查（Dockerfile 的 HEALTHCHECK，ADR-0010）：请求片库服务的 /api/health（公开接口，不需要令牌），
 * 200 且返回 { ok: true } 退出 0，其余（非 200、ok 不是 true、连不上、4 秒没有回应）退出 1。
 *
 * 地址取服务同一组环境变量：YINGBOX_PORT（默认 31480）、YINGBOX_HOST（监听 0.0.0.0 / :: 或没设时连 127.0.0.1）。
 */
const port = process.env.YINGBOX_PORT?.trim() || '31480'
const listen = process.env.YINGBOX_HOST?.trim() || '127.0.0.1'
const host = ['0.0.0.0', '::', '[::]'].includes(listen) ? '127.0.0.1' : listen
const authority =
  host.includes(':') && !host.startsWith('[') ? `[${host}]` : host

try {
  const response = await fetch(`http://${authority}:${port}/api/health`, {
    signal: AbortSignal.timeout(4000),
  })
  const body = await response.json().catch(() => null)
  process.exit(response.status === 200 && body?.ok === true ? 0 : 1)
} catch {
  process.exit(1)
}
