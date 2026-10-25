<template>
  <!-- 头图（效果图 D-1）：大背景铺满窗口（含侧栏后面），下部渐进模糊并压暗到页面底色，文案压在左下 -->
  <header class="lib-hero">
    <img
      v-if="backdrop"
      class="lib-hero-image"
      :src="backdrop"
      alt=""
      decoding="async"
      @load="onFadeIn"
    />
    <span class="yb-pblur lib-hero-blur" aria-hidden="true"
      ><i /><i /><i /><i
    /></span>
    <div class="lib-hero-side" aria-hidden="true" />
    <div class="lib-hero-content">
      <img
        v-if="logo && !logoBroken"
        class="lib-hero-logo"
        :src="logo"
        :alt="node.title"
        decoding="async"
        referrerpolicy="no-referrer"
        @error="logoBroken = true"
      />
      <h1 v-else class="lib-hero-title">{{ node.title }}</h1>
      <!-- 主操作：白色播放胶囊 + 想看；番号库再加去码组。管理操作在右上角「更多」里 -->
      <div class="lib-hero-actions">
        <UiButton
          class="lib-hero-play"
          variant="primary"
          size="lg"
          icon="play"
          :label="playLabel"
          :disabled="!canPlay"
          @click="emit('play')"
        />
        <WatchlistButton
          class="lib-hero-circle yb-glass"
          :meta="watchlistMeta"
        />
        <template v-if="restorable">
          <UiButton
            class="lib-hero-glass yb-glass"
            icon="sparkle"
            size="lg"
            label="去码"
            :disabled="restoreRunning"
            @click="emit('restore', 'restore')"
          />
          <UiIconButton
            class="lib-hero-circle yb-glass"
            icon="range"
            size="lg"
            label="去码一段"
            @click="emit('restore', 'range')"
          />
          <UiIconButton
            class="lib-hero-circle yb-glass"
            icon="livePlay"
            size="lg"
            label="边跑边看"
            @click="emit('restore', 'live')"
          />
        </template>
      </div>
      <p v-if="tagline" class="lib-hero-tagline">{{ tagline }}</p>
      <p
        v-if="node.overview"
        class="lib-hero-overview"
        :class="{ 'is-expanded': overviewOpen }"
        :title="overviewOpen ? '' : '点击展开'"
        @click="overviewOpen = !overviewOpen"
      >
        {{ node.overview }}
      </p>
      <p v-if="metaParts.length || specs.length" class="lib-hero-meta">
        <span v-for="part in metaParts" :key="part" class="lib-hero-meta-part">
          {{ part }}
        </span>
        <span v-if="specs.length" class="lib-hero-specs">
          <UiSpecBadge
            v-for="spec in specs"
            :key="`${spec.variant}:${spec.text}`"
            v-bind="spec"
          />
        </span>
        <span
          v-if="node.matchState === 'review' || node.matchState === 'unmatched'"
          class="lib-hero-state"
          >{{ MATCH_STATE_LABEL[node.matchState] }}</span
        >
      </p>
      <p v-for="line in credits" :key="line.label" class="lib-hero-credit">
        <span class="lib-hero-credit-label">{{ line.label }}</span
        >{{ line.names }}
      </p>
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * 详情头图（Apple TV 式，效果图 D-1）：背景图铺满窗口，下部三层渐进模糊 + 压暗到页面底色，左侧再压一层暗，
 * 文案在左下：标志（加载失败退回片名）、白色播放胶囊 + 想看玻璃圆钮（番号库再加去码 / 去码一段 / 边跑边看）、
 * 标语与两行简介（点击展开）、规格行（年份 · 时长或季数 · 评分 · 类型 + 分级圆标与动态范围标签 + 待确认角标）、
 * 主演 / 导演行。返回圆钮、管理操作（修正匹配、锁定、重新获取、写出 NFO、整理）在 ItemDetail 的浮动控件里。
 * 换条目时重置标志失败与简介展开状态。
 */
import { computed, ref, watch } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import type { SpecBadge } from '@/components/ui/spec-badge'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'
import { WatchlistButton } from '@/features/watchlist'

import { MATCH_STATE_LABEL } from '../shared/format'
import type { CreditLine } from './detail-view'
import { watchlistMetaOf } from './playback'
import type { RestoreAction } from './use-restore'

const props = defineProps<{
  node: LibraryItemNode
  backdrop: string | null
  logo: string | null
  tagline: string
  /** 规格行文字（不含分级） */
  metaParts: string[]
  /** 规格标签（分级圆标、动态范围） */
  specs: SpecBadge[]
  /** 主演 / 导演行 */
  credits: CreditLine[]
  playLabel: string
  canPlay: boolean
  /** 显示去码入口（见 use-restore） */
  restorable: boolean
  /** 整片去码正在跑：去码按钮置灰 */
  restoreRunning: boolean
}>()

const emit = defineEmits<{
  play: []
  restore: [action: RestoreAction]
}>()

const watchlistMeta = computed(() => watchlistMetaOf(props.node))
const logoBroken = ref(false)
const overviewOpen = ref(false)

watch(
  () => props.node.id,
  () => {
    logoBroken.value = false
    overviewOpen.value = false
  }
)

function onFadeIn(event: Event): void {
  ;(event.target as HTMLElement).dataset.loaded = ''
}
</script>

<style scoped src="./detail-section.css"></style>
<style scoped>
.lib-hero {
  position: relative;
  display: flex;
  align-items: flex-end;
  min-height: max(560px, 88vh);
  padding: var(--space-10) var(--detail-gutter) var(--space-7) var(--detail-x);
  overflow: hidden;
  background: var(--bg-fill-secondary);
  isolation: isolate;
}
.lib-hero-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 20%;
  opacity: 0;
  transition: opacity var(--duration-slow) var(--ease-out);
}
.lib-hero-image[data-loaded] {
  opacity: 1;
}
/* 下部渐进模糊，最上层从透明压到页面底色，文字落在实色上，亮暗主题都清楚 */
.lib-hero-blur {
  --pblur-height: 50%;
  --pblur-tint: linear-gradient(
    transparent 0%,
    color-mix(in srgb, var(--bg-content) 42%, transparent) 38%,
    color-mix(in srgb, var(--bg-content) 80%, transparent) 80%,
    var(--bg-content) 100%
  );
}
.lib-hero-side {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--bg-content) 55%, transparent) 0%,
    color-mix(in srgb, var(--bg-content) 35%, transparent) 30%,
    transparent 58%
  );
  pointer-events: none;
}
.lib-hero-content {
  position: relative;
  z-index: var(--z-raised);
  width: min(640px, 100%);
}
.lib-hero-logo {
  display: block;
  max-width: min(320px, 70%);
  max-height: 150px;
  margin-bottom: var(--space-5);
  object-fit: contain;
  object-position: left bottom;
  filter: var(--media-logo-shadow);
}
.lib-hero-title {
  margin: 0 0 var(--space-5);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-weight-bold); /* style-tokens: visual（片名大标题） */
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}

/* —— 操作：48px 白色播放胶囊 + 玻璃圆钮 —— */
.lib-hero-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}
.lib-hero-play {
  height: var(--space-9);
  padding: 0 var(--space-6_5) 0 var(--space-5);
  font-size: var(--text-md);
}
.lib-hero-glass {
  height: var(--space-9);
  color: var(--text-primary);
}
.lib-hero-circle {
  --ib-size: var(--space-9);
  border-radius: var(--radius-full);
  color: var(--text-primary);
}
/* 按钮基类自带底色，玻璃底色在这里显式写回（见 ui.css .yb-glass 的说明） */
.lib-hero-circle,
.lib-hero-glass {
  background: var(--glass-bg);
}
.lib-hero-circle:hover:not(:disabled),
.lib-hero-glass:hover:not(:disabled) {
  background: var(--glass-bg-hover);
}
.lib-hero-circle.is-active {
  background: var(--bg-active);
}

.lib-hero-tagline {
  margin: 0 0 var(--space-1);
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
}
.lib-hero-overview {
  display: -webkit-box;
  width: min(600px, 100%);
  margin: 0 0 var(--space-3_5);
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-md);
  line-height: 1.62;
  cursor: pointer;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
}
.lib-hero-overview.is-expanded {
  display: block;
}

/* —— 规格行：年份 · 类型 · 季数 + 标签 —— */
.lib-hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) 0;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.lib-hero-meta-part + .lib-hero-meta-part::before {
  margin: 0 var(--space-2);
  content: '·';
}
.lib-hero-specs {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1_5);
  margin-left: var(--space-3);
}
.lib-hero-state {
  margin-left: var(--space-3);
  padding: var(--space-0_5) var(--space-2);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  color: var(--warning);
  font-size: var(--text-2xs);
  font-weight: var(--font-weight-medium);
}
.lib-hero-credit {
  margin: var(--space-2_5) 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-hero-credit + .lib-hero-credit {
  margin-top: var(--space-1);
}
.lib-hero-credit-label {
  margin-right: var(--space-1_5);
  color: var(--text-tertiary);
}

@media (max-width: 720px) {
  .lib-hero {
    min-height: max(480px, 70vh);
  }
}
</style>
