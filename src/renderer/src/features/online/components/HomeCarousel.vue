<template>
  <section class="home-feature" aria-label="首页精选">
    <nav class="home-categories" aria-label="影视分类">
      <UiPressable
        v-for="category in categories"
        :key="category.label"
        class="home-category"
        :class="{ 'is-current': matches(category) }"
        :aria-current="matches(category) ? 'page' : undefined"
        @click="selectCategory(category)"
        >{{ category.label }}</UiPressable
      >
    </nav>
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
      <Transition name="hero-fade" mode="out-in">
        <img
          v-if="art(current)"
          :key="art(current)"
          class="hero-art"
          :src="art(current)"
          alt=""
          referrerpolicy="no-referrer"
          @error="broken.add(art(current))"
        />
      </Transition>
      <div class="hero-shade" />
      <div
        class="hero-copy"
        :aria-live="paused ? 'polite' : 'off'"
        aria-atomic="true"
      >
        <span class="hero-eyebrow">今日精选</span>
        <h1>{{ current.title }}</h1>
        <div class="hero-meta">
          <span>{{
            [current.year, current.type].filter(Boolean).join(' · ')
          }}</span>
          <span v-if="Number(current.rate) > 0" class="hero-rating"
            >豆瓣 {{ current.rate }}</span
          >
        </div>
        <p v-if="current.overview" class="hero-overview">
          {{ current.overview }}
        </p>
        <div class="hero-actions">
          <UiButton
            icon="play"
            variant="primary"
            label="选源播放"
            @click="emit('open', current)"
          />
          <UiButton
            class="hero-details"
            label="查看详情"
            @click="emit('open', current)"
          />
        </div>
      </div>
      <template v-if="slides.length > 1">
        <UiIconButton
          class="hero-arrow hero-prev"
          variant="overlay"
          icon="back"
          label="上一部影片"
          @click="move(-1)"
        />
        <UiIconButton
          class="hero-arrow hero-next"
          variant="overlay"
          icon="forward"
          label="下一部影片"
          @click="move(1)"
        />
        <div class="hero-controls">
          <div class="hero-thumbs" aria-label="选择影片">
            <UiPressable
              v-for="(item, index) in slides"
              :key="item.url"
              class="hero-thumb"
              :class="{ 'is-current': index === selected }"
              :label="`切换到 ${item.title}`"
              :aria-pressed="index === selected"
              @click="selected = index"
            >
              <img
                v-if="art(item)"
                :src="art(item)"
                alt=""
                referrerpolicy="no-referrer"
                @error="broken.add(art(item))"
              />
              <span v-else>{{ item.title }}</span>
            </UiPressable>
          </div>
          <div class="hero-pagination">
            <span
              >{{ String(selected + 1).padStart(2, '0') }} /
              {{ String(slides.length).padStart(2, '0') }}</span
            >
            <span
              v-for="(_, index) in slides"
              :key="index"
              class="hero-segment"
              :class="{ 'is-current': index === selected }"
            />
            <UiIconButton
              variant="overlay"
              size="sm"
              :icon="paused ? 'play' : 'pause'"
              :label="paused ? '开启自动轮播' : '暂停自动轮播'"
              @click="paused = !paused"
            />
          </div>
        </div>
      </template>
    </section>
    <div
      v-else-if="status === 'idle' || status === 'loading'"
      class="hero-loading"
      aria-busy="true"
      aria-label="正在加载精选影片"
    >
      <UiSkeleton landscape :count="1" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onActivated, onDeactivated, reactive, ref, watch } from 'vue'
import {
  useDocumentVisibility,
  useIntervalFn,
  usePreferredReducedMotion,
} from '@vueuse/core'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPressable from '@/components/ui/UiPressable.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { useDoubanFeed } from '../composables/use-douban-feed'
import type { DoubanItem } from '../types'
import type { DoubanQuery } from '../../../../../shared/douban/query'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ open: [item: DoubanItem] }>()
const feed = useDoubanFeed()
const { items, query, status } = feed
const categories = [
  { label: '精选', kind: 'movie', tag: '热门' },
  { label: '电影', kind: 'movie', tag: '最新' },
  { label: '电视剧', kind: 'tv', tag: '热门' },
  { label: '动漫', kind: 'tv', tag: '日本动画' },
  { label: '纪录片', kind: 'tv', tag: '纪录片' },
] satisfies Array<{ label: string; kind: DoubanQuery['kind']; tag: string }>
type Category = (typeof categories)[number]
const matches = (category: Category): boolean =>
  query.value.kind === category.kind && query.value.tag === category.tag
const selectCategory = async (category: Category): Promise<void> => {
  await feed.setQuery({ kind: category.kind, tag: category.tag })
}
const slides = computed(() => items.value.slice(0, 3))
const selected = ref(0)
const current = computed(() => slides.value[selected.value])
watch(
  () => slides.value.map(item => item.url).join('|'),
  () => {
    selected.value = 0
  }
)
const broken = reactive(new Set<string>())
const art = (item: DoubanItem): string =>
  [item.backdrop, item.cover, item.coverSrc].find(
    url => url && !broken.has(url)
  ) || ''
const move = (direction: number): void => {
  selected.value =
    (selected.value + direction + slides.value.length) % slides.value.length
}
const reducedMotion = usePreferredReducedMotion()
const visibility = useDocumentVisibility()
const paused = ref(reducedMotion.value === 'reduce')
const hovered = ref(false)
const focused = ref(false)
const mounted = ref(true)
onActivated(() => {
  mounted.value = true
})
onDeactivated(() => {
  mounted.value = false
})
const onFocusOut = (event: FocusEvent): void => {
  if (
    !(event.currentTarget as HTMLElement).contains(
      event.relatedTarget as Node | null
    )
  )
    focused.value = false
}
useIntervalFn(() => {
  if (
    props.active &&
    mounted.value &&
    visibility.value === 'visible' &&
    !paused.value &&
    !hovered.value &&
    !focused.value &&
    reducedMotion.value !== 'reduce' &&
    slides.value.length > 1
  )
    move(1)
}, 7000)
</script>

<style scoped src="./home-carousel.css"></style>
