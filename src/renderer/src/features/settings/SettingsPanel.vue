<template>
  <!-- 遮罩层 -->
  <Transition name="settings-fade">
    <div v-if="visible" class="settings-backdrop" @click="requestClose" />
  </Transition>

  <!-- 设置窗口：大标题 + 左侧分区卡片 + 右侧分组内容（Apple 设置式） -->
  <Transition name="settings-pop">
    <div
      v-if="visible"
      class="settings-window"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
      @click.stop
    >
      <div
        ref="frameRef"
        class="settings-frame"
        tabindex="-1"
        @keydown="trapTab"
      >
        <header class="settings-head">
          <h1 class="settings-heading">设置</h1>
          <UiIconButton
            class="settings-close"
            icon="close"
            variant="secondary"
            size="lg"
            label="关闭设置"
            @click="requestClose"
          />
        </header>
        <div class="settings-body">
          <SettingsNav
            v-model:query="navQuery"
            :sections="visibleSections"
            :active-id="current?.id"
            :badges="navBadges"
            @select="selectSection"
          />

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
 * 本组件只负责外壳：遮罩、大标题与关闭钮、左侧分区导航（含搜索）和右侧内容切换。
 * 分区来自注册表（registry.ts），打开时才加载；成人模式关闭时隐藏 adultOnly 分区。
 * 分区可 defineExpose({ canLeave }) 拦截切换与关闭（如未保存的修改）。
 * 软件更新状态需要在窗口关闭时也持续接收，所以这里一创建就启动 useUpdateStatus。
 */
import { type Component, computed, ref, shallowRef, watch } from 'vue'

import UiIconButton from '@/components/ui/UiIconButton.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'
import { useModalFocus } from '@/composables/use-focus-trap'

import { settingsSections } from './registry'
import SettingsNav from './ui/SettingsNav.vue'
import { useSectionNavigation } from './use-section-navigation'
import { useSetting } from './use-setting'
import { useUpdateStatus } from './use-update-status'

const props = defineProps<{ visible: boolean; initialSection?: string }>()
const emit = defineEmits<{ close: [] }>()

const { status: updateStatus } = useUpdateStatus()

/** 有新版本可装时给「软件更新」挂一个红色角标 */
const navBadges = computed(
  (): Record<string, number> =>
    updateStatus.value === 'available' || updateStatus.value === 'downloaded'
      ? { update: 1 }
      : {}
)

// ── 分区导航 ────────────────────────────────────────────────
const {
  navQuery,
  visibleSections,
  current,
  sectionProps,
  selectSection,
  openTarget,
} = useSectionNavigation({
  sections: () => settingsSections,
  adultMode: useSetting('app.adultMode'),
  canLeave,
})

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

function requestClose(): void {
  if (canLeave()) emit('close')
}

watch(
  () => [props.visible, props.initialSection] as const,
  ([visible, initial]) => {
    if (visible && initial) openTarget(initial)
  }
)

// ── 打开/关闭行为 ───────────────────────────────────────────
useEscapeLayer(() => props.visible, requestClose)
// 模态：焦点移进窗口、Tab 不跑到背后的页面、关闭后还回去
const frameRef = ref<HTMLElement | null>(null)
const trapTab = useModalFocus(frameRef, () => props.visible)

watch(
  () => props.visible,
  v => {
    if (v) navQuery.value = ''
  }
)
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
  outline: none;
  display: flex;
  flex-direction: column;
  width: min(1180px, calc(100vw - 48px));
  height: min(820px, calc(100vh - 48px));
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-2xl);
  background: var(--bg-main);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
}

/* ── 大标题 + 关闭圆钮 ── */
.settings-head {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-6) var(--space-6) var(--space-5) var(--space-7);
}

.settings-heading {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
}

.settings-close.yb-icon-button {
  background: var(--bg-active);
}

.settings-body {
  display: flex;
  flex: 1;
  gap: var(--space-6);
  min-width: 0;
  min-height: 0;
  padding: 0 0 var(--space-6) var(--space-7);
}

/* 开关：iOS 尺寸；分段控件：胶囊底 + 白色选中块（只在设置窗口里放大） */
.settings-window :deep(.ui-switch) {
  width: 46px;
  height: 28px;
}
.settings-window :deep(.ui-switch)::after {
  width: 24px;
  height: 24px;
}
.settings-window :deep(.ui-switch:checked)::after {
  transform: translateX(18px);
}
.settings-window :deep(.ui-segmented) {
  border-radius: var(--radius-full);
  background: var(--bg-active);
}
.settings-window :deep(.ui-segmented-item) {
  border-radius: var(--radius-full);
}
.settings-window :deep(.ui-segmented-item.is-active) {
  background: var(--action-bg);
  color: var(--action-text);
  font-weight: var(--font-weight-semibold);
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
  padding: var(--space-1) var(--space-7) var(--space-1) var(--space-4);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
}

.settings-scroll {
  flex: 1;
  min-height: 0;
  padding: 0 var(--space-7) var(--space-2) 0;
  overflow-y: auto;
}

.settings-fill {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: var(--space-4) var(--space-7) 0 0;
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
  .settings-head {
    padding: var(--space-4) var(--space-3) var(--space-3) var(--space-4);
  }
  .settings-heading {
    font-size: var(--text-2xl);
  }
  .settings-body {
    flex-direction: column;
    gap: var(--space-3);
    padding: 0 var(--space-3) var(--space-3);
  }
  .settings-main-title {
    padding: 0 var(--space-4) var(--space-1);
  }
  .settings-scroll {
    padding: 0 0 var(--space-6);
  }
  .settings-fill {
    padding: var(--space-3) 0 0;
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
