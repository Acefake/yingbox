/**
 * 网页端与片库服务同步的设置（键见 shared/settings/server-keys.ts：PanSou 地址、115 转存目标等）。
 *
 * 网页端设置存在浏览器里，但服务端的网盘 / 追更模块要读这几个键，所以：
 * - 启动时等片库服务连上后拉一次服务端的值，盖到本地（服务端为准，换浏览器也一致）；
 * - 写这几个键时先写服务端（校验失败或被环境变量固定时抛错，调用方回滚），再存浏览器。
 * 桌面端不经过这里（设置在主进程）。
 */
import {
  SERVER_SETTINGS_HTTP,
  type ServerSettingsSnapshot,
  isServerSettingKey,
} from '../../../../shared/settings/server-keys'
import {
  isWebRuntime,
  probeLibraryServer,
  serverFetch,
} from '@/services/library-server'

/** 是否要同步到服务端（网页端且是服务端保存的键） */
export function syncsToServer(key: string): boolean {
  return isWebRuntime() && isServerSettingKey(key)
}

/** 片库服务连上后拉服务端的值，逐个交给 apply；没连上 / 出错时什么都不做 */
export async function pullServerSettings(
  apply: (key: string, value: unknown) => void
): Promise<void> {
  if (!isWebRuntime() || (await probeLibraryServer()) !== 'online') return
  const response = await serverFetch(SERVER_SETTINGS_HTTP)
  if (!response.ok) return
  const snapshot = (await response.json()) as ServerSettingsSnapshot
  for (const [key, value] of Object.entries(snapshot.values ?? {}))
    if (isServerSettingKey(key) && value !== undefined) apply(key, value)
}

/** 写一个键到服务端；被拒时抛出服务端给的原因 */
export async function pushServerSetting(
  key: string,
  value: unknown
): Promise<void> {
  const response = await serverFetch(SERVER_SETTINGS_HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
  if (response.ok) return
  let reason = `HTTP ${response.status}`
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') reason = body.error
  } catch {
    /* 正文不是 JSON 时用状态码 */
  }
  throw new Error(`保存到片库服务失败：${reason}`)
}
