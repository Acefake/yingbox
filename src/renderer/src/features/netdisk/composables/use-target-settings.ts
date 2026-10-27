/**
 * 渲染层读转存目标相关的设置（电影 / 剧集默认目录与原转存目标），拼成 shared/netdisk/target-folder.ts 要的形状。
 *
 * 读设置的函数由调用方传入（通常是 features/settings 的 useSetting）：本文件会经 features/netdisk/index.ts 被别的 feature
 * 引到，不能在导入时把设置模块一起拉进来（设置模块导入即初始化，测试环境没有 localStorage）。
 */
import { type ComputedRef, type Ref, computed } from 'vue'

import {
  TARGET_SETTING_KEYS,
  type TargetSettings,
} from '../../../../../shared/netdisk/target-folder'

/** 读一个设置项的响应式引用（useSetting 的形状） */
export type ReadSetting = (key: keyof TargetSettings) => Readonly<Ref<string>>

/** 当前的转存目标设置（跟着设置变化） */
export function useTargetSettings(
  read: ReadSetting
): ComputedRef<TargetSettings> {
  const refs = TARGET_SETTING_KEYS.map(key => [key, read(key)] as const)
  return computed(
    () =>
      Object.fromEntries(
        refs.map(([key, value]) => [key, value.value])
      ) as unknown as TargetSettings
  )
}
