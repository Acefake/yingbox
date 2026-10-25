/**
 * 技能注册表：助手核心按当前状态取出生效的技能包，提示词、JSON Schema、建议胶囊都由它们动态拼出。
 *
 * 应用里只有一个注册表（{@link assistantSkills}）：内置技能在助手浮层第一次打开时登记，
 * 私密技能由 private-skills.ts 按设置动态加载 / 卸载。注册表本身不引用任何功能模块，放在主包里也很轻。
 * 读 list() / active() 的 computed 会在注册 / 卸载时重新计算。
 */
import { shallowRef } from 'vue'

import type {
  AssistantContext,
  AssistantSkill,
  SkillScope,
} from './skill-types'

/** 技能注册表 */
export interface SkillRegistry {
  /** 登记一个技能包（同 id 的替换掉） */
  register: (skill: AssistantSkill) => void
  /** 卸载；不存在时无效果 */
  unregister: (id: string) => void
  /** 已登记的全部技能包（响应式） */
  list: () => readonly AssistantSkill[]
  /** 当前状态下生效的技能包：私密时只要 private / any，否则只要 normal / any */
  active: (context: Pick<AssistantContext, 'private'>) => AssistantSkill[]
  /** 有没有登记某个技能包 */
  has: (id: string) => boolean
}

/** 范围是否在当前模式下生效 */
export function scopeActive(scope: SkillScope, isPrivate: boolean): boolean {
  return scope === 'any' || scope === (isPrivate ? 'private' : 'normal')
}

/** 新建一个注册表（测试各自建，应用用 {@link assistantSkills}） */
export function createSkillRegistry(): SkillRegistry {
  const skills = shallowRef<readonly AssistantSkill[]>([])
  return {
    register(skill) {
      skills.value = [...skills.value.filter(s => s.id !== skill.id), skill]
    },
    unregister(id) {
      if (skills.value.some(s => s.id === id))
        skills.value = skills.value.filter(s => s.id !== id)
    },
    list: () => skills.value,
    active: context =>
      skills.value.filter(s => scopeActive(s.scope, context.private)),
    has: id => skills.value.some(s => s.id === id),
  }
}

/** 应用唯一的技能注册表 */
export const assistantSkills = createSkillRegistry()
