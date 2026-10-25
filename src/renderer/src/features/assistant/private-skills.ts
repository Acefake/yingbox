/**
 * 私密技能包的按需加载：设置打开时动态 import（独立 chunk）并登记，关闭时卸载并清空对话上下文。
 *
 * 助手核心不知道私密技能是什么：应用入口把开关与加载函数交进来（installPrivateSkills），
 * 开关关闭时这里不会下载那段代码，提示词、建议与界面里也就不会出现它的任何字样。
 */
import { watch } from 'vue'

import { clearAssistantSession } from './assistant-session'
import { type SkillRegistry, assistantSkills } from './skills/skill-registry'
import type { AssistantSkill } from './skills/skill-types'

/** 私密技能模块的形状：默认导出一个或多个技能包 */
export interface PrivateSkillModule {
  default: AssistantSkill | readonly AssistantSkill[]
}

/** installPrivateSkills 的参数 */
export interface PrivateSkillsOptions {
  /** 现在是否允许私密技能（响应式读取的设置开关） */
  enabled: () => boolean
  /** 加载私密技能模块（动态 import） */
  load: () => Promise<PrivateSkillModule>
  /** 注册表；缺省用应用的 */
  registry?: SkillRegistry
}

/**
 * 跟随开关加载 / 卸载私密技能。
 * @returns 停止跟随（并卸载已登记的私密技能）
 */
export function installPrivateSkills(
  options: PrivateSkillsOptions
): () => void {
  const registry = options.registry ?? assistantSkills
  let loaded: string[] = []
  let generation = 0

  const unload = (): void => {
    for (const id of loaded) registry.unregister(id)
    loaded = []
    clearAssistantSession()
  }

  const stop = watch(
    options.enabled,
    async on => {
      const token = ++generation
      if (!on) {
        unload()
        return
      }
      try {
        const module = await options.load()
        if (token !== generation || !options.enabled()) return
        const skills = ([] as AssistantSkill[]).concat(module.default)
        for (const skill of skills) registry.register(skill)
        loaded = skills.map(skill => skill.id)
      } catch (error) {
        console.warn('[assistant] 私密技能加载失败', error)
      }
    },
    { immediate: true }
  )

  return () => {
    stop()
    generation += 1
    unload()
  }
}
