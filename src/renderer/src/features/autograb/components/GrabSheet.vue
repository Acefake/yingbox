<template>
  <Teleport to="body">
    <Transition name="grab-sheet-fade" appear>
      <div v-if="open" class="grab-sheet-scrim" @click="emit('close')" />
    </Transition>
    <Transition name="grab-sheet-slide" appear>
      <aside
        v-if="open"
        class="grab-sheet yb-glass"
        role="dialog"
        :aria-label="title"
        @click.stop
      >
        <header v-if="hero" class="grab-sheet-hero">
          <img
            v-if="image"
            class="grab-sheet-hero-bg"
            :src="image"
            alt=""
            aria-hidden="true"
          />
          <UiIconButton
            class="grab-sheet-close"
            icon="close"
            variant="overlay"
            size="sm"
            label="关闭"
            @click="emit('close')"
          />
          <div class="grab-sheet-hero-row">
            <GrabPoster :src="image ?? null" :title="title" size="lg" />
            <div class="grab-sheet-hero-text">
              <h2 class="grab-sheet-title">{{ title }}</h2>
              <p v-if="subtitle" class="grab-sheet-hero-sub">{{ subtitle }}</p>
            </div>
          </div>
        </header>
        <DialogTitlebar v-else :title="title" @close="emit('close')" />
        <div class="grab-sheet-body custom-scrollbar">
          <p v-if="subtitle && !hero" class="grab-sheet-sub">{{ subtitle }}</p>
          <slot />
        </div>
        <footer v-if="$slots.footer" class="grab-sheet-foot">
          <slot name="footer" />
        </footer>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 追更侧拉面板：玻璃浮层（同后台任务面板的材质与外形），从右侧滑出，离窗口边留出外壳间距，
 * 覆盖在页面上（不插入文档流，页面滚动位置不动）。内容一般是几组 SettingsGroup；footer 插槽是底部固定的操作条。
 * 给了 hero（剧的面板）时顶部是海报头：放大模糊的海报做底色，左边小海报，右边剧名与说明，关闭钮压在画面上；
 * 否则是普通的 DialogTitlebar。image 是已换好的海报地址，没有时海报头是按剧名算的渐变。
 * Esc 与点遮罩都关闭；Esc 走 useEscapeLayer，一次只关最上面一层。
 */
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { useEscapeLayer } from '@/composables/use-escape-layer'

import GrabPoster from './GrabPoster.vue'

const props = defineProps<{
  open: boolean
  title: string
  subtitle?: string
  /** 顶部用海报头 */
  hero?: boolean
  /** 海报头的海报地址 */
  image?: string | null
}>()
const emit = defineEmits<{ close: [] }>()

useEscapeLayer(
  () => props.open,
  () => emit('close')
)
</script>

<style scoped>
.grab-sheet-scrim {
  position: fixed;
  inset: 0;
  z-index: var(--z-sheet);
  background: var(--overlay-scrim-soft);
}

/* 玻璃材质（底色、模糊、内高光、投影）来自 .yb-glass，这里只管形状与布局 */
.grab-sheet {
  position: fixed;
  top: var(--space-3);
  right: var(--space-3);
  bottom: var(--space-3);
  z-index: calc(var(--z-sheet) + 1);
  display: flex;
  flex-direction: column;
  width: min(480px, calc(100vw - var(--space-6)));
  border-radius: var(--radius-2xl);
  color: var(--text-primary);
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.grab-sheet-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-5);
  min-height: 0;
  padding: 0 var(--space-5) var(--space-5);
  overflow-y: auto;
}

/* 海报头：模糊放大的海报压暗做底，往下渐隐到面板底色 */
.grab-sheet-hero {
  position: relative;
  flex: none;
  padding: var(--space-9) var(--space-5) var(--space-4);
  overflow: hidden;
  isolation: isolate;
}

.grab-sheet-hero::after {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(
    color-mix(in srgb, var(--bg-elevated) 20%, transparent),
    var(--bg-elevated)
  );
  content: '';
}

.grab-sheet-hero-bg {
  position: absolute;
  inset: calc(var(--space-7) * -1);
  z-index: -1;
  width: calc(100% + var(--space-7) * 2);
  height: calc(100% + var(--space-7) * 2);
  object-fit: cover;
  filter: blur(36px) saturate(1.5) brightness(0.7);
}

.grab-sheet-close {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
}

.grab-sheet-hero-row {
  display: flex;
  align-items: flex-end;
  gap: var(--space-4);
}

.grab-sheet-hero-text {
  min-width: 0;
}

.grab-sheet-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: var(--font-weight-semibold);
  letter-spacing: var(--tracking-tight);
  line-height: var(--leading-tight);
}

.grab-sheet-hero-sub {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* 海报头下面的内容与海报头拉开一点 */
.grab-sheet-hero + .grab-sheet-body {
  padding-top: var(--space-3);
}

.grab-sheet-foot {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-5);
  border-top: 1px solid var(--separator);
}

.grab-sheet-sub {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.grab-sheet-fade-enter-active,
.grab-sheet-fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}

.grab-sheet-slide-enter-active,
.grab-sheet-slide-leave-active {
  transition: var(--transition-panel);
}

.grab-sheet-fade-enter-from,
.grab-sheet-fade-leave-to {
  opacity: 0;
}

.grab-sheet-slide-enter-from,
.grab-sheet-slide-leave-to {
  opacity: 0;
  transform: translateX(var(--space-8));
}
</style>
