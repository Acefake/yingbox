/**
 * 网盘 / 追更模块的开关（只读环境变量，不改 src/server/config.ts 的命令行参数表）：
 *
 * | 环境变量          | 默认 | 含义                                                                 |
 * | ----------------- | ---- | -------------------------------------------------------------------- |
 * | YINGBOX_NETDISK   | on   | off 时不加载 pan115 / 追更 / 洗版 / 电影追踪 / 库外发现，接口返回未启用 |
 * | YINGBOX_AUTOGRAB  | on   | off 时接口照常可用，但本实例不跑定时任务（留给另一个实例）             |
 *
 * 设置类的覆盖（YINGBOX_PANSOU_URL、YINGBOX_MOUNT_ROOT）见 settings-store。
 */

/** 开关 */
export interface NetdiskConfig {
  enabled: boolean
  autograb: boolean
}

/** on / off 开关；认 1 / 0、true / false、yes / no，空为默认值，别的写法抛错 */
function flag(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean
): boolean {
  const raw = env[name]?.trim().toLowerCase()
  if (!raw) return fallback
  if (['on', '1', 'true', 'yes'].includes(raw)) return true
  if (['off', '0', 'false', 'no'].includes(raw)) return false
  throw new Error(`${name} 应为 on 或 off：${env[name]}`)
}

/** 读开关 */
export function loadNetdiskConfig(env: NodeJS.ProcessEnv): NetdiskConfig {
  return {
    enabled: flag(env, 'YINGBOX_NETDISK', true),
    autograb: flag(env, 'YINGBOX_AUTOGRAB', true),
  }
}
