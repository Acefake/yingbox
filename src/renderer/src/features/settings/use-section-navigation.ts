/**
 * 设置窗口的分区导航状态：按成人模式与搜索词筛选分区、当前分区（含 "<分区>:<子页>" 的子页）、
 * 切换前询问当前分区能否离开。与界面无关，SettingsPanel 只负责把它接到模板上。
 */
import { type ComputedRef, type Ref, computed, ref, watch } from 'vue'

import type { SettingsSection } from './registry'

/** useSectionNavigation 的依赖 */
export interface SectionNavigationOptions {
  /** 全部已登记的分区（响应式读取） */
  sections: () => readonly SettingsSection[]
  /** 成人模式开关；关闭时隐藏 adultOnly 分区 */
  adultMode: Ref<boolean>
  /** 当前分区是否允许离开（有未保存修改时由分区自己确认） */
  canLeave: () => boolean
}

/** useSectionNavigation 的返回值 */
export interface SectionNavigation {
  /** 左侧搜索词 */
  navQuery: Ref<string>
  /** 按搜索词筛选后的分区 */
  visibleSections: ComputedRef<SettingsSection[]>
  /** 当前分区（目标不可用时退回第一个可见 / 可用分区） */
  current: ComputedRef<SettingsSection | undefined>
  /** 传给当前分区组件的属性（分区固定属性 + 子页 sub） */
  sectionProps: ComputedRef<Record<string, unknown>>
  /** 切到某分区；当前分区拒绝离开时返回 false */
  selectSection: (id: string, sub?: string) => boolean
  /** 按 "<分区>:<子页>" 打开分区（分区不可用时忽略），成功后清空搜索词 */
  openTarget: (target: string) => void
}

/** 创建设置窗口的分区导航状态 */
export function useSectionNavigation(
  options: SectionNavigationOptions
): SectionNavigation {
  const available = computed(() =>
    options
      .sections()
      .filter(section => options.adultMode.value || !section.adultOnly)
  )

  const navQuery = ref('')
  /** 当前分区与它的子页（切换分区后清空子页） */
  const target = ref<{ id: string; sub?: string }>({ id: 'appearance' })

  const visibleSections = computed(() => {
    const q = navQuery.value.trim().toLowerCase()
    if (!q) return available.value
    return available.value.filter(s =>
      `${s.title} ${s.keywords}`.toLowerCase().includes(q)
    )
  })

  const current = computed(
    () =>
      available.value.find(s => s.id === target.value.id) ??
      visibleSections.value[0] ??
      available.value[0]
  )

  const sectionProps = computed(() => ({
    ...current.value?.props,
    ...(target.value.sub ? { sub: target.value.sub } : {}),
  }))

  function selectSection(id: string, sub?: string): boolean {
    if (id !== current.value?.id && !options.canLeave()) return false
    target.value = { id, sub }
    return true
  }

  function openTarget(value: string): void {
    const [id, sub] = value.split(':')
    if (!available.value.some(s => s.id === id)) return
    if (selectSection(id, sub)) navQuery.value = ''
  }

  // 搜索结果里没有当前分区时跳到第一个结果；当前分区拒绝离开则清空搜索词留在原处
  watch(navQuery, () => {
    const vis = visibleSections.value
    if (vis.length && !vis.some(s => s.id === current.value?.id)) {
      if (selectSection(vis[0].id)) return
      navQuery.value = ''
    }
  })

  return {
    navQuery,
    visibleSections,
    current,
    sectionProps,
    selectSection,
    openTarget,
  }
}
