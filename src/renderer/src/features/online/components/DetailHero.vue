<template>
  <div class="dw-hero">
    <!-- 海报 -->
    <div class="dw-poster-wrap">
      <img
        :src="
          tmdbDetail?.poster_path
            ? `https://images.tmdb.org/t/p/w342${tmdbDetail.poster_path}`
            : itemPic
        "
        class="dw-poster"
        @error="onImgError"
      />
    </div>
    <!-- 信息 -->
    <div class="dw-info">
      <h1 class="dw-title">
        {{ tmdbDetail?.title || tmdbDetail?.name || itemName }}
      </h1>
      <h3
        v-if="tmdbDetail?.original_title || tmdbDetail?.original_name"
        class="dw-orig-title"
      >
        {{ tmdbDetail?.original_title || tmdbDetail?.original_name }}
      </h3>
      <div class="dw-meta-row">
        <span v-if="tmdbDetail?.vote_average" class="dw-rating">
          <UiIcon name="star" size="sm" filled />
          {{ tmdbDetail.vote_average.toFixed(1) }}
        </span>
        <span
          v-if="tmdbDetail?.release_date || tmdbDetail?.first_air_date"
          class="dw-tag"
        >
          {{
            (tmdbDetail.release_date || tmdbDetail.first_air_date || '').slice(
              0,
              4
            )
          }}
        </span>
        <span v-if="tmdbDetail?.runtime" class="dw-tag"
          >{{ tmdbDetail.runtime }} 分钟</span
        >
        <span
          v-for="g in (tmdbDetail?.genres || []).slice(0, 4)"
          :key="g.id"
          class="dw-tag"
          >{{ g.name }}</span
        >
        <span
          v-if="
            itemData?._source === 'catspider' || itemData?._source === 'cms'
          "
          class="dw-tag"
          :class="{
            'source-vod': itemData._source === 'catspider',
            'source-cms': itemData._source === 'cms',
          }"
        >
          {{ itemData._source === 'catspider' ? '插件源' : 'CMS' }}
          <template v-if="itemData.source_name"
            >· {{ itemData.source_name }}</template
          >
        </span>
      </div>
      <div class="dw-actions">
        <UiButton
          v-if="currentEpisodes.length"
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
      <p v-if="tmdbDetail?.overview || itemOverview" class="dw-overview">
        {{ tmdbDetail?.overview || itemOverview }}
      </p>
      <div class="dw-meta-table">
        <div v-if="directors.length" class="dw-meta-item">
          <span class="dw-meta-label">导演</span>
          <span class="dw-meta-val">{{ directors.join('、') }}</span>
        </div>
        <div
          v-if="(tmdbDetail?.production_countries || []).length"
          class="dw-meta-item"
        >
          <span class="dw-meta-label">地区</span>
          <span class="dw-meta-val">{{
            (tmdbDetail?.production_countries ?? []).map(c => c.name).join('、')
          }}</span>
        </div>
      </div>
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 在线详情页的主信息块：海报、标题、评分 / 年份 / 类型 / 来源标签、播放按钮、简介和导演地区。
 * 播放源选择通过默认插槽放在信息列的末尾；actions 插槽接在播放按钮后面（如「想看」）。
 */
import UiButton from '@/components/ui/UiButton.vue'
import UiIcon from '@/components/ui/UiIcon.vue'
import type { Episode, OnlineDetailItem, PluginExt, TmdbDetail } from '../types'

defineProps<{
  tmdbDetail: TmdbDetail | null
  itemData: OnlineDetailItem | null
  itemName: string
  itemPic: string
  itemOverview: string
  directors: string[]
  currentEpisodes: Episode[]
}>()
const emit = defineEmits<{
  (e: 'play', url: string, ext?: PluginExt): void
}>()

const onImgError = (e: Event): void => {
  ;(e.target as HTMLImageElement).src =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="140" height="210"><rect width="140" height="210" fill="%231f2937"/><text x="70" y="110" text-anchor="middle" fill="%236b7280" font-size="13">无封面</text></svg>'
}
</script>

<style scoped>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.dw-hero {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: var(--space-6_5);
  align-items: flex-start;
  margin-bottom: var(--space-7);
}

.dw-poster-wrap {
  flex-shrink: 0;
  width: 220px;
}

.dw-poster {
  display: block;
  width: 100%;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.dw-info {
  min-width: 0;
  overflow-wrap: anywhere;
}

.dw-title {
  margin: 0 0 var(--space-1);
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-weight-bold);
  letter-spacing: var(--tracking-tight);
  line-height: var(--leading-tight);
}

.dw-orig-title {
  margin: 0 0 var(--space-4);
  color: var(--text-tertiary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-regular);
}

.dw-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.dw-rating {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.dw-rating em {
  display: none;
}

.dw-tag {
  color: var(--text-secondary);
  white-space: nowrap;
}

.dw-rating .app-icon {
  color: var(--rating);
}

.dw-rating + .dw-tag::before,
.dw-tag + .dw-tag::before {
  content: '·';
  margin-right: var(--space-2);
  color: var(--text-quaternary);
}

.dw-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-6);
}

.dw-overview {
  max-width: 64ch;
  margin: 0 0 var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-md);
  line-height: 1.65;
}

.dw-meta-table {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}

.dw-meta-item {
  display: flex;
  gap: var(--space-2);
}

.dw-meta-label {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  width: 36px;
  flex-shrink: 0;
  margin-top: 1px;
}

.dw-meta-val {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

@media (max-width: 860px) {
  .dw-hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .dw-poster-wrap {
    width: min(220px, 100%);
  }
}
</style>
