<template>
  <section
    v-if="current"
    class="home-hero"
    role="region"
    aria-roledescription="轮播图"
    aria-label="精选影片"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
    @focusin="focused = true"
    @focusout="onFocusOut"
  >
    <TransitionGroup name="home-hero-fade" tag="div" class="home-hero-stage">
      <img
        v-if="current.art && !broken.has(current.art)"
        :key="current.art"
        class="home-hero-art"
        :class="{ 'is-poster': current.artIsPoster }"
        :src="webImageSrc(current.art)"
        alt=""
        referrerpolicy="no-referrer"
        @error="broken.add(current.art)"
      />
    </TransitionGroup>
    <span class="yb-pblur home-hero-blur" aria-hidden="true"
      ><i /><i /><i /><i
    /></span>
    <div class="home-hero-side" aria-hidden="true" />

    <Transition name="home-hero-fade" mode="out-in">
      <div
        :key="current.key"
        class="home-hero-copy"
        :aria-live="autoplay ? 'off' : 'polite'"
        aria-atomic="true"
      >
        <div class="home-hero-kicker">{{ current.kicker }}</div>
        <img
          v-if="current.logo && !broken.has(current.logo)"
          class="home-hero-logo"
          :src="current.logo"
          :alt="current.title"
          referrerpolicy="no-referrer"
          @error="broken.add(current.logo)"
        />
        <h1 v-else class="home-hero-title">{{ current.title }}</h1>
        <div
          v-if="current.meta.length || current.specs.length || hasRating"
          class="home-hero-meta"
        >
          <template v-for="(item, index) in current.meta" :key="item">
            <span v-if="index" aria-hidden="true">·</span>
            <span>{{ item }}</span>
          </template>
          <span v-if="current.specs.length" class="home-hero-specs">
            <UiSpecBadge
              v-for="spec in current.specs"
              :key="`${spec.variant}:${spec.text}`"
              v-bind="spec"
            />
          </span>
          <span v-if="hasRating" class="home-hero-ratings">
            <UiRatingBadge inline :douban="current.ratings.douban" />
            <UiRatingBadge inline :tmdb="current.ratings.tmdb" />
            <span
              v-if="!current.ratings.douban && !current.ratings.tmdb"
              class="home-hero-rating"
              >{{ current.rating }}</span
            >
          </span>
        </div>
        <p v-if="current.overview" class="home-hero-overview">
          {{ current.overview }}
        </p>
        <div class="home-hero-actions">
          <UiPressable class="home-hero-play" @click="current.play()"
            ><UiIcon name="play" size="lg" filled />{{
              current.playLabel
            }}</UiPressable
          >
          <UiPressable
            v-if="current.watchlist"
            class="home-hero-watch"
            :aria-pressed="listed"
            @click="toggleListed"
            ><UiIcon
              :name="listed ? 'check' : 'plus'"
              size="lg"
            />待看</UiPressable
          >
          <UiPressable
            class="home-hero-info"
            :label="`${current.title}的详情`"
            @click="current.open()"
            ><UiIcon name="info" size="lg"
          /></UiPressable>
        </div>
      </div>
    </Transition>

    <!-- 缩略图条：当前一张白框，点按切换 -->
    <div v-if="slides.length > 1" class="home-hero-thumbs">
      <UiPressable
        v-for="(slide, index) in slides"
        :key="slide.key"
        class="home-hero-thumb"
        :class="{ 'is-current': index === selected }"
        :label="`第 ${index + 1} 部：${slide.title}`"
        :aria-current="index === selected ? 'true' : undefined"
        @click="selected = index"
      >
        <img
          v-if="slide.thumb && !broken.has(slide.thumb)"
          :src="webImageSrc(slide.thumb)"
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          @error="broken.add(slide.thumb)"
        />
      </UiPressable>
    </div>
  </section>
  <div
    v-else-if="loading"
    class="home-hero is-loading"
    aria-busy="true"
    aria-label="正在加载精选影片"
  />
</template>

<script setup lang="ts">
/**
 * 首页全幅 Hero（Apple TV 式）：铺到窗口左上角（浮动侧栏与顶栏胶囊之下），大背景剧照下半渐进模糊并渐黑，
 * 左下自上而下是标签行（来源 · 进度）、标志图（没有就用大号片名）、元信息（年份 · 类型 · 时长、规格标签、评分）、
 * 一行简介，以及白色主按钮（「继续播放 · 剩 48 分钟」/「播放」）、玻璃「待看」与圆形「详情」；
 * 右下是 5 张缩略图条（当前一张白框，点按切换）。每 8 秒自动换一部；悬停、键盘聚焦、窗口隐藏、
 * 页面切走或系统「减少动态效果」时不换。
 * 数据见 use-home-hero.ts；背景图加载失败时只留黑底和文字。
 */
import { computed, onActivated, onDeactivated, reactive, ref, watch } from 'vue'
import {
  useDocumentVisibility,
  useIntervalFn,
  usePreferredReducedMotion,
} from '@vueuse/core'

import { toast } from '@/components/ui'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiRatingBadge from '@/components/ui/UiRatingBadge.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'
import { inWatchlist, toggleWatchlist } from '@/features/watchlist'
import { webImageSrc } from '@/services/thumbnails'

import type { HeroSlide } from '../composables/use-home-hero'

const props = defineProps<{
  slides: HeroSlide[]
  loading: boolean
  /** 首页当前可见（标签页切走、详情盖住时不轮播） */
  active: boolean
}>()

const selected = ref(0)
const current = computed<HeroSlide | undefined>(
  () => props.slides[selected.value] ?? props.slides[0]
)
/** 这一页有评分（来源小标或文字兜底） */
const hasRating = computed(() => Boolean(current.value?.rating))
watch(
  () => props.slides.map(slide => slide.key).join('|'),
  () => (selected.value = 0)
)

/** 加载失败的图片地址 */
const broken = reactive(new Set<string>())

const listed = computed(() => {
  const meta = current.value?.watchlist
  return meta ? inWatchlist(meta.section, meta.key) : false
})

function toggleListed(): void {
  const meta = current.value?.watchlist
  if (meta) toast.success(toggleWatchlist(meta) ? '已加入想看' : '已从想看移除')
}

// —— 自动轮播 ——
const reducedMotion = usePreferredReducedMotion()
const visibility = useDocumentVisibility()
const hovered = ref(false)
const focused = ref(false)
const mounted = ref(true)
onActivated(() => (mounted.value = true))
onDeactivated(() => (mounted.value = false))

const autoplay = computed(
  () =>
    props.active &&
    mounted.value &&
    visibility.value === 'visible' &&
    !hovered.value &&
    !focused.value &&
    reducedMotion.value !== 'reduce' &&
    props.slides.length > 1
)

function onFocusOut(event: FocusEvent): void {
  const root = event.currentTarget as HTMLElement
  if (!root.contains(event.relatedTarget as Node | null)) focused.value = false
}

useIntervalFn(() => {
  if (autoplay.value)
    selected.value = (selected.value + 1) % props.slides.length
}, 8000)
</script>

<style scoped src="./home-hero.css"></style>
