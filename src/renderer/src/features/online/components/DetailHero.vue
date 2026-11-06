<template>
  <!-- 头图：与本地电影 / 剧集详情页同一版式（Apple TV 式）——剧照铺满，下部渐进模糊并压暗，文案压在左下 -->
  <header class="dw-hero yb-on-media" :class="{ 'is-phone': isPhone }">
    <img
      v-if="image"
      class="dw-hero-image"
      :src="webImageSrc(image)"
      alt=""
      decoding="async"
      @load="onFadeIn"
      @error="onImgError"
    />
    <span class="yb-pblur dw-hero-blur" aria-hidden="true"
      ><i /><i /><i /><i
    /></span>
    <div class="dw-hero-side" aria-hidden="true" />
    <div class="dw-hero-content">
      <h1 class="dw-hero-title">
        <img
          v-if="logo && !logoBroken"
          class="dw-hero-logo"
          :src="logo"
          :alt="title"
          @error="logoBroken = true"
        />
        <template v-else>{{ title }}</template>
      </h1>
      <h2 v-if="originalTitle" class="dw-hero-orig">{{ originalTitle }}</h2>
      <!-- 主操作：白色播放胶囊 + 想看等玻璃圆钮 -->
      <div class="dw-hero-actions">
        <UiButton
          v-if="currentEpisodes.length"
          class="dw-hero-play"
          variant="primary"
          size="lg"
          icon="play"
          :label="
            currentEpisodes.length > 1
              ? `播放 ${currentEpisodes[0].name}`
              : '播放'
          "
          @click="emit('play', currentEpisodes[0].url, currentEpisodes[0].ext)"
        />
        <slot name="actions" />
      </div>
      <p
        v-if="overview"
        class="dw-hero-overview"
        :class="{ 'is-expanded': overviewOpen }"
        :title="overviewOpen ? '' : '点击展开'"
        @click="overviewOpen = !overviewOpen"
      >
        {{ overview }}
      </p>
      <p class="dw-hero-meta">
        <UiRatingBadge
          inline
          :douban="doubanRating"
          :tmdb="tmdbDetail?.vote_average"
        />
        <span v-for="part in metaParts" :key="part" class="dw-hero-meta-part">
          {{ part }}
        </span>
        <span v-if="sourceTag" class="dw-hero-meta-part">{{ sourceTag }}</span>
      </p>
      <p v-for="line in credits" :key="line.label" class="dw-hero-credit">
        <span class="dw-hero-credit-label">{{ line.label }}</span
        >{{ line.names }}
      </p>
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * 在线详情页的头图：剧照（没有就用海报）铺满、下部渐进模糊 + 压暗，左下是片名、原名、播放胶囊 + 想看等玻璃圆钮
 * （actions 插槽）、两行简介（点击展开）、评分 · 年份 · 时长 · 类型 · 来源，以及导演 / 主演 / 地区。
 * 版式与库内详情（features/library/detail/DetailHero.vue）一致；播放源选择与演员剧照在头图下面（DetailWindow）。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiRatingBadge from '@/components/ui/UiRatingBadge.vue'
import { usePlatform } from '@/composables/use-platform'
import { webImageSrc } from '@/services/thumbnails'
import { computed, ref, watch } from 'vue'
import type { DoubanMetadata } from '../../../../../shared/douban/detail'
import type { Episode, OnlineDetailItem, PluginExt, TmdbDetail } from '../types'

const { isPhone } = usePlatform()

const props = defineProps<{
  doubanDetail?: DoubanMetadata | null
  tmdbDetail: TmdbDetail | null
  logo: string | null
  itemData: OnlineDetailItem | null
  itemName: string
  itemPic: string
  itemOverview: string
  /** 剧照；没有时用海报 */
  backdrop: string
  directors: string[]
  actors: string[]
  currentEpisodes: Episode[]
}>()

const emit = defineEmits<{
  (e: 'play', url: string, ext?: PluginExt): void
}>()

const logoBroken = ref(false)
watch(
  () => props.logo,
  () => {
    logoBroken.value = false
  }
)
const overviewOpen = ref(false)
watch(
  () => props.itemName,
  () => {
    overviewOpen.value = false
  }
)

const image = computed(() => props.backdrop || props.itemPic)
const title = computed(
  () =>
    props.doubanDetail?.title ||
    props.tmdbDetail?.title ||
    props.tmdbDetail?.name ||
    props.itemName
)
const originalTitle = computed(() => {
  const orig =
    props.doubanDetail?.originalTitle ||
    props.tmdbDetail?.original_title ||
    props.tmdbDetail?.original_name ||
    ''
  return orig && orig !== title.value ? orig : ''
})
const overview = computed(
  () =>
    props.doubanDetail?.intro ||
    props.tmdbDetail?.overview ||
    props.itemOverview
)
const doubanRating = computed(
  () =>
    props.doubanDetail?.rating?.value || Number(props.itemData?.doubanRating)
)
const year = computed(
  () =>
    props.doubanDetail?.year ||
    (
      props.tmdbDetail?.release_date ||
      props.tmdbDetail?.first_air_date ||
      props.itemData?.vod_year ||
      ''
    ).slice(0, 4)
)
const duration = computed(
  () =>
    props.doubanDetail?.duration ||
    (props.tmdbDetail?.runtime ? `${props.tmdbDetail.runtime} 分钟` : '')
)
const genres = computed(() =>
  props.doubanDetail?.genres.length
    ? props.doubanDetail.genres
    : (props.tmdbDetail?.genres ?? []).map(g => g.name)
)
const countries = computed(() =>
  props.doubanDetail?.countries.length
    ? props.doubanDetail.countries
    : (props.tmdbDetail?.production_countries ?? []).map(c => c.name)
)
/** 年份 · 时长 · 类型；评分由来源角标显示。 */
const metaParts = computed(() =>
  [year.value, duration.value, ...genres.value.slice(0, 4)].filter(Boolean)
)
const sourceTag = computed(() => {
  const data = props.itemData
  if (data?._source !== 'catspider' && data?._source !== 'cms') return ''
  const kind = data._source === 'catspider' ? '插件源' : 'CMS'
  return data.source_name ? `${kind} · ${data.source_name}` : kind
})
const credits = computed(() =>
  [
    { label: '导演', names: props.directors.join('、') },
    { label: '主演', names: props.actors.slice(0, 6).join('、') },
    { label: '地区', names: countries.value.join('、') },
  ].filter(line => line.names)
)

function onFadeIn(event: Event): void {
  ;(event.target as HTMLElement).dataset.loaded = ''
}

/** 图片加载失败：留着渐变底色，不显示破图 */
function onImgError(event: Event): void {
  ;(event.target as HTMLElement).style.display = 'none'
}
</script>

<style scoped>
.dw-hero {
  position: relative;
  display: flex;
  align-items: flex-end;
  min-height: max(480px, 76svh);
  padding: var(--space-10) var(--detail-gutter)
    calc(var(--space-7) + var(--hero-detail-lift)) var(--detail-x);
  overflow: hidden;
  -webkit-mask-image: var(--hero-detail-mask);
  mask-image: var(--hero-detail-mask);
  background: var(--bg-fill-secondary);
  isolation: isolate;
}

.dw-hero-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 20%;
  opacity: 0;
  transition: opacity var(--duration-slow) var(--ease-out);
}

.dw-hero-image[data-loaded] {
  opacity: 1;
}

/* 下部渐进模糊，最上层压暗（浅色主题在 --hero-detail-mask 里渐隐到页面底色） */
.dw-hero-blur {
  --pblur-height: 50%;
  --pblur-tint: var(--scrim-detail-hero);
}

.dw-hero-side {
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

.dw-hero-content {
  position: relative;
  z-index: var(--z-raised);
  width: min(640px, 100%);
  overflow-wrap: anywhere;
}

.dw-hero-logo {
  display: block;
  max-width: min(100%, 440px);
  max-height: 140px;
  object-fit: contain;
  object-position: left bottom;
  filter: var(--media-logo-shadow);
}
.dw-hero-title {
  margin: 0 0 var(--space-2);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-weight-bold); /* style-tokens: visual（片名大标题） */
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}

.dw-hero-orig {
  margin: 0 0 var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-regular);
}

/* —— 操作：48px 白色播放胶囊 + 玻璃圆钮（插槽里的想看等按钮） —— */
.dw-hero-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin: var(--space-5) 0;
}

.dw-hero-play {
  height: var(--space-9);
  padding: 0 var(--space-6_5) 0 var(--space-5);
  font-size: var(--text-md);
}

.dw-hero-actions :slotted(.dw-hero-circle) {
  --ib-size: var(--space-9);
  border-radius: var(--radius-full);
  background: var(--glass-bg);
  color: var(--text-primary);
}

.dw-hero-actions :slotted(.dw-hero-circle:hover:not(:disabled)) {
  background: var(--glass-bg-hover);
}

.dw-hero-overview {
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

.dw-hero-overview.is-expanded {
  display: block;
}

/* 规格行：来源评分角标、年份、时长、类型与片源 */
.dw-hero-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1) 0;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}

.ui-rating-badge + .dw-hero-meta-part::before,
.dw-hero-meta-part + .dw-hero-meta-part::before {
  margin: 0 var(--space-2);
  content: '·';
}

.dw-hero-credit {
  margin: var(--space-2_5) 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dw-hero-credit + .dw-hero-credit {
  margin-top: var(--space-1);
}

.dw-hero-credit-label {
  margin-right: var(--space-1_5);
  color: var(--text-tertiary);
}

@media (max-width: 720px) {
  .dw-hero {
    min-height: max(420px, 76svh);
  }
}

.dw-hero.is-phone .dw-hero-title {
  font-size: var(--text-2xl);
}
</style>
