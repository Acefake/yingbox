/**
 * frodo 回退的开关：默认开启。
 *
 * - 桌面端：常量 {@link DOUBAN_FRODO_DEFAULT}（开）；调试时也可以用同一个环境变量关掉；
 * - 独立服务 / NAS：环境变量 `YINGBOX_DOUBAN_FRODO=off`（也认 0 / false / no）关闭。
 * 关闭后豆瓣请求只走 m.douban.com/rexxar，行为与没有 frodo 回退时一致。
 */

/** 开关的环境变量名。 */
export const FRODO_SWITCH_ENV = 'YINGBOX_DOUBAN_FRODO'

/** 桌面端缺省：开启。 */
export const DOUBAN_FRODO_DEFAULT = true

const OFF = new Set(['off', '0', 'false', 'no'])

/**
 * frodo 回退是否开启。
 * @param env 环境变量表；缺省读当前进程的 process.env（两个 utilityProcess 与独立服务都继承宿主的环境）
 */
export function frodoEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  const value = env[FRODO_SWITCH_ENV]?.trim().toLowerCase()
  if (!value) return DOUBAN_FRODO_DEFAULT
  return !OFF.has(value)
}
