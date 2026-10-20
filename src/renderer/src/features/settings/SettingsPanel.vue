<template>
  <!-- 遮罩层 -->
  <Transition name="settings-fade">
    <div v-if="visible" class="settings-backdrop" @click="requestClose" />
  </Transition>

  <!-- 设置窗口：左侧分区导航 + 右侧分组内容（macOS 系统设置式） -->
  <Transition name="settings-pop">
    <div
      v-if="visible"
      class="settings-window"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      @click.stop
    >
      <div class="settings-frame">
        <DialogTitlebar title="设置" icon="settings" @close="requestClose" />
        <div class="settings-body">
          <!-- 左侧：搜索 + 分区导航 -->
          <aside class="settings-nav">
            <UiInput
              v-model="navQuery"
              class="settings-search"
              variant="filled"
              size="sm"
              icon="search"
              placeholder="搜索设置"
              aria-label="搜索设置"
            />
            <nav class="settings-nav-list" aria-label="设置分区">
              <UiNavItem
                v-for="sec in visibleSections"
                :key="sec.id"
                class="settings-nav-item"
                :label="sec.title"
                :icon="sec.icon"
                :active="current?.id === sec.id"
                @click="selectSection(sec.id)"
              />
              <p v-if="visibleSections.length === 0" class="settings-nav-empty">
                没有匹配的设置
              </p>
            </nav>
          </aside>

          <!-- 右侧：内容区。fill 分区自管滚动，其余由面板统一滚动 -->
          <section
            v-if="current"
            class="settings-main"
            :aria-label="current.title"
          >
            <h2 class="settings-main-title">{{ current.title }}</h2>
            <div
              :class="
                current.fill
                  ? 'settings-fill'
                  : 'settings-scroll custom-scrollbar'
              "
            >
              <component
                :is="loaded"
                v-if="loaded"
                ref="sectionRef"
                v-bind="sectionProps"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * 全局设置窗口。
 *
 * 本组件只负责外壳：遮罩、标题栏、左侧分区导航（含搜索）和右侧内容切换。
 * 分区来自注册表（registry.ts），打开时才加载；成人模式关闭时隐藏 adultOnly 分区。
 * 分区可 defineExpose({ canLeave }) 拦截切换与关闭（如 Amane 的未保存修改）。
 * 软件更新状态需要在窗口关闭时也持续接收，所以这里一创建就启动 useUpdateStatus。
 */
import {
  type Component,
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue'

import DialogTitlebar from '@/components/DialogTitlebar.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiNavItem from '@/components/ui/UiNavItem.vue'

import { settingsSections } from './registry'
import { useSetting } from './use-setting'
import { useUpdateStatus } from './use-update-status'

const props = defineProps<{ visible: boolean; initialSection?: string }>()
const emit = defineEmits<{ close: [] }>()

useUpdateStatus()

// ── 分区导航 ────────────────────────────────────────────────
const adultMode = useSetting('app.adultMode')
const available = computed(() =>
  settingsSections.filter(section => adultMode.value || !section.adultOnly)
)

const navQuery = ref('')
/** 当前分区与它的子页（来自 "<分区>:<子页>"，切换分区后清空） */
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

// ── 分区组件懒加载 ───────────────────────────────────────────
const loaded = shallowRef<Component | null>(null)
const sectionRef = ref<{ canLeave?: () => boolean } | null>(null)

watch(
  () => (props.visible ? current.value : undefined),
  async section => {
    loaded.value = null
    if (!section) return
    const module = await section.load()
    if (current.value === section) loaded.value = module.default
  },
  { immediate: true }
)

/** 当前分区有未保存修改时由它自己确认，返回 false 表示留在原处 */
function canLeave(): boolean {
  return sectionRef.value?.canLeave?.() !== false
}

function selectSection(id: string, sub?: string): boolean {
  if (id !== current.value?.id && !canLeave()) return false
  target.value = { id, sub }
  return true
}

function requestClose(): void {
  if (canLeave()) emit('close')
}

watch(
  () => [props.visible, props.initialSection] as const,
  ([visible, initial]) => {
    if (!visible || !initial) return
    const [id, sub] = initial.split(':')
    if (!available.value.some(s => s.id === id)) return
    if (selectSection(id, sub)) navQuery.value = ''
  }
)

watch(navQuery, () => {
  const vis = visibleSections.value
  if (vis.length && !vis.some(s => s.id === current.value?.id)) {
    if (selectSection(vis[0].id)) return
    navQuery.value = ''
  }
})

// ── 打开/关闭行为 ───────────────────────────────────────────
const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') requestClose()
}

watch(
  () => props.visible,
  v => {
    if (v) {
      navQuery.value = ''
      window.addEventListener('keydown', onKeydown)
    } else {
      window.removeEventListener('keydown', onKeydown)
    }
  }
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-settings);
  background: var(--overlay-scrim-soft);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.settings-window {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-settings) + 1);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.settings-frame {
  display: flex;
  flex-direction: column;
  width: min(980px, calc(100vw - 48px));
  height: min(740px, calc(100vh - 72px));
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-main);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}

.settings-body {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

/* ── 左侧导航：靠底色和内容区分开，不画分隔线 ── */
.settings-nav {
  display: flex;
  flex: 0 0 216px;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-4) var(--space-3);
  background: var(--bg-sidebar);
}

.settings-search {
  flex: 0 0 auto;
  margin-bottom: var(--space-3);
}

.settings-nav-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-0_5);
  min-height: 0;
  overflow-y: auto;
}

/* 分区导航项即 UiNavItem 的默认外观，这里不再重复 */
.settings-nav-empty {
  margin: var(--space-2) var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

/* ── 右侧内容 ── */
.settings-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.settings-main-title {
  flex: 0 0 auto;
  margin: 0;
  padding: var(--space-6) var(--space-7) var(--space-4);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
}

.settings-scroll {
  flex: 1;
  min-height: 0;
  padding: 0 var(--space-7) var(--space-7);
  overflow-y: auto;
}

.settings-fill {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0 var(--space-7) var(--space-4);
}
.settings-fill > * {
  flex: 1;
  min-height: 0;
}

/* ── 动效 ── */
.settings-fade-enter-active,
.settings-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}
.settings-fade-enter-from,
.settings-fade-leave-to {
  opacity: 0;
}

.settings-pop-enter-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}
.settings-pop-enter-active .settings-frame {
  transition:
    opacity var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}
.settings-pop-enter-from {
  opacity: 0;
}
.settings-pop-enter-from .settings-frame {
  opacity: 0;
  transform: scale(0.97) translateY(10px);
}
.settings-pop-leave-active {
  transition: opacity var(--duration-fast) ease;
}
.settings-pop-leave-active .settings-frame {
  transition:
    opacity var(--duration-fast) ease,
    transform var(--duration-fast) ease;
}
.settings-pop-leave-to {
  opacity: 0;
}
.settings-pop-leave-to .settings-frame {
  opacity: 0;
  transform: scale(0.985) translateY(6px);
}

/* ── 窄屏：整窗 + 顶部横向分区 ── */
@media (max-width: 720px) {
  .settings-frame {
    width: 100vw;
    height: 100dvh;
    border: 0;
    border-radius: 0;
  }
  .settings-body {
    flex-direction: column;
  }
  .settings-nav {
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
  }
  .settings-search {
    flex: 0 0 132px;
    margin-bottom: 0;
  }
  .settings-nav-list {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .settings-nav-item {
    flex: 0 0 auto;
    width: auto;
  }
  .settings-nav-empty {
    display: none;
  }
  .settings-main-title {
    padding: var(--space-4) var(--space-4) var(--space-3);
  }
  .settings-scroll {
    padding: 0 var(--space-4) var(--space-6);
  }
  .settings-fill {
    padding: 0 var(--space-3) var(--space-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-pop-enter-active,
  .settings-pop-leave-active,
  .settings-pop-enter-active .settings-frame,
  .settings-pop-leave-active .settings-frame {
    transition: opacity var(--duration-normal) ease;
  }
  .settings-pop-enter-from .settings-frame,
  .settings-pop-leave-to .settings-frame {
    transform: none;
  }
}
</style>
