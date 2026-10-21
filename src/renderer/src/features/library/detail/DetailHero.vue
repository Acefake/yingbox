<template>
  <!-- 头图：背景图渐隐到页面底色，标志 / 片名、信息行、操作、简介叠在上面 -->
  <header class="lib-hero">
    <img
      v-if="backdrop"
      class="lib-hero-image"
      :src="backdrop"
      alt=""
      decoding="async"
      @load="onFadeIn"
    />
    <div class="lib-hero-fade" />
    <UiIconButton
      class="lib-hero-back"
      icon="back"
      variant="overlay"
      label="返回"
      @click="emit('close')"
    />
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
      <p v-if="metaLine.length" class="lib-hero-meta">
        <span v-for="part in metaLine" :key="part" class="lib-hero-meta-part">
          {{ part }}
        </span>
        <span
          v-if="node.matchState === 'review' || node.matchState === 'unmatched'"
          class="lib-hero-state"
          >{{ MATCH_STATE_LABEL[node.matchState] }}</span
        >
      </p>
      <div class="lib-hero-actions">
        <UiButton
          variant="primary"
          size="lg"
          icon="play"
          :label="playLabel"
          :disabled="!canPlay"
          @click="emit('play')"
        />
        <UiIconButton
          icon="wand"
          variant="secondary"
          size="lg"
          label="修正匹配"
          @click="emit('fix-match', node.id)"
        />
        <UiIconButton
          :icon="node.matchState === 'locked' ? 'lock' : 'pin'"
          variant="secondary"
          size="lg"
          :active="node.matchState === 'locked'"
          :label="node.matchState === 'locked' ? '解除锁定' : '锁定匹配'"
          :disabled="!node.providerIds.tmdb"
          :loading="busy === 'lock'"
          @click="emit('toggle-lock')"
        />
        <UiIconButton
          icon="refresh"
          variant="secondary"
          size="lg"
          label="重新获取元数据"
          :disabled="!node.providerIds.tmdb"
          :loading="busy === 'refresh'"
          @click="emit('refresh')"
        />
        <span v-tooltip="writerAvailable ? '' : WRITER_UNAVAILABLE">
          <UiIconButton
            icon="save"
            variant="secondary"
            size="lg"
            label="写出 NFO 与图片"
            :disabled="!writerAvailable || !node.providerIds.tmdb"
            :loading="busy === 'write'"
            @click="emit('write')"
          />
        </span>
        <span v-tooltip="writerAvailable ? '' : WRITER_UNAVAILABLE">
          <UiIconButton
            icon="folder"
            variant="secondary"
            size="lg"
            label="整理…"
            :disabled="!writerAvailable"
            @click="emit('organize', [node.id])"
          />
        </span>
      </div>
      <p v-if="tagline" class="lib-hero-tagline">{{ tagline }}</p>
      <p
        v-if="node.overview"
        class="lib-hero-overview"
        :class="{ 'is-expanded': overviewOpen }"
        @click="overviewOpen = !overviewOpen"
      >
        {{ node.overview }}
      </p>
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * 详情头图：780w 背景图渐隐、标志（加载失败退回片名）、信息行与待确认角标、
 * 播放 / 修正匹配 / 锁定 / 重新获取 / 写出 / 整理，标语与可展开的简介。
 * 换条目时重置标志失败与简介展开状态。
 */
import { ref, watch } from 'vue'

import type { LibraryItemNode } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { vTooltip } from '@/components/ui/tooltip'

import { MATCH_STATE_LABEL } from '../shared/format'
import { WRITER_UNAVAILABLE } from '../writer/use-writer'

const props = defineProps<{
  node: LibraryItemNode
  backdrop: string | null
  logo: string | null
  tagline: string
  metaLine: string[]
  playLabel: string
  canPlay: boolean
  /** 进行中的操作（lock / refresh / write），null 表示空闲。 */
  busy: string | null
  writerAvailable: boolean
}>()

const emit = defineEmits<{
  close: []
  play: []
  'fix-match': [itemId: number]
  'toggle-lock': []
  refresh: []
  write: []
  organize: [itemIds: number[]]
}>()

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

<style scoped>
.lib-hero {
  position: relative;
  display: flex;
  align-items: flex-end;
  min-height: max(440px, 62vh);
  padding: var(--space-10) var(--content-padding-x) var(--space-8);
  overflow: hidden;
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
/* 底部与左侧渐隐到页面底色，文字落在实色上，亮暗主题都清楚 */
.lib-hero-fade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(
      to top,
      var(--bg-content) 0%,
      color-mix(in srgb, var(--bg-content) 70%, transparent) 30%,
      transparent 65%
    ),
    linear-gradient(
      to right,
      color-mix(in srgb, var(--bg-content) 85%, transparent) 0%,
      transparent 60%
    );
}
.lib-hero-back {
  position: absolute;
  top: var(--space-6);
  left: var(--content-padding-x);
  z-index: var(--z-raised);
}
.lib-hero-content {
  position: relative;
  z-index: var(--z-raised);
  max-width: 640px;
}
.lib-hero-logo {
  display: block;
  max-width: min(420px, 70%);
  max-height: 140px;
  margin-bottom: var(--space-5);
  object-fit: contain;
  object-position: left bottom;
}
.lib-hero-title {
  margin: 0 0 var(--space-4);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}
.lib-hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) 0;
  margin: 0 0 var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.lib-hero-meta-part + .lib-hero-meta-part::before {
  margin: 0 var(--space-2);
  content: '·';
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
.lib-hero-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-5);
}
.lib-hero-actions > span {
  display: inline-flex;
}
.lib-hero-tagline {
  margin: 0 0 var(--space-2);
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
}
.lib-hero-overview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  cursor: pointer;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}
.lib-hero-overview.is-expanded {
  display: block;
}
</style>
