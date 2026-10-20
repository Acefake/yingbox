<template>
  <div class="mi-root">
    <div v-if="loading" class="mi-empty">加载中...</div>
    <template v-else-if="movieInfo">
      <!-- Apple TV 式元信息行：评分 · 年份 · 时长 · 类型 -->
      <div v-if="hasMetaRow" class="mi-meta-row">
        <span v-if="movieInfo.rating" class="mi-rating">
          <UiIcon name="star" size="sm" filled />
          {{ movieInfo.rating }}
        </span>
        <span v-if="movieInfo.year" class="mi-tag">{{ movieInfo.year }}</span>
        <span v-if="movieInfo.runtime" class="mi-tag">{{
          movieInfo.runtime
        }}</span>
        <span
          v-for="g in (movieInfo.genre || []).slice(0, 4)"
          :key="g"
          class="mi-tag"
          >{{ g }}</span
        >
      </div>

      <!-- 操作区（由父组件提供，位于元信息与简介之间） -->
      <slot name="actions" />

      <p v-if="movieInfo.plot" class="mi-overview">{{ movieInfo.plot }}</p>

      <dl class="mi-table">
        <div v-if="movieInfo.director" class="mi-item">
          <dt>导演</dt>
          <dd>{{ movieInfo.director }}</dd>
        </div>
        <div
          v-if="!hideActors && movieInfo.actor && movieInfo.actor.length > 0"
          class="mi-item"
        >
          <dt>演员</dt>
          <dd>{{ movieInfo.actor.join('、') }}</dd>
        </div>
        <div v-if="movieInfo.country" class="mi-item">
          <dt>国家</dt>
          <dd>{{ movieInfo.country }}</dd>
        </div>
        <div v-if="movieInfo.studio" class="mi-item">
          <dt>制片</dt>
          <dd>{{ movieInfo.studio }}</dd>
        </div>
        <div v-if="movieInfo.premiered" class="mi-item">
          <dt>首映</dt>
          <dd>{{ movieInfo.premiered }}</dd>
        </div>
      </dl>
    </template>
    <slot v-else name="actions" />
  </div>
</template>

<script setup lang="ts">
/**
 * 本地电影的元信息块，视觉与在线详情页（DetailWindow）一致：
 * 一行评分/年份/时长/类型，随后是操作区插槽、简介和导演等次要信息。
 */
import { computed } from 'vue'
import UiIcon from '@/components/ui/UiIcon.vue'

interface MovieInfoType {
  title?: string
  originaltitle?: string
  year?: string
  plot?: string
  genre?: string[]
  director?: string
  actor?: string[]
  rating?: string
  runtime?: string
  country?: string
  studio?: string
  premiered?: string
}

interface Props {
  movieInfo: MovieInfoType | null
  posterUrl: string
  loading: boolean
  /** 父组件已经用头像列表展示演员时，隐藏文字版演员行 */
  hideActors?: boolean
}

const props = defineProps<Props>()

defineEmits<{
  downloadPoster: []
}>()

const hasMetaRow = computed(() => {
  const info = props.movieInfo
  return Boolean(
    info && (info.rating || info.year || info.runtime || info.genre?.length)
  )
})
</script>

<style scoped>
.mi-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.mi-rating {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.mi-rating .app-icon {
  color: var(--rating);
}
.mi-tag {
  white-space: nowrap;
}
.mi-rating + .mi-tag::before,
.mi-tag + .mi-tag::before {
  content: '·';
  margin-right: var(--space-2);
  color: var(--text-quaternary);
}
.mi-overview {
  max-width: 64ch;
  margin: 0 0 var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-md);
  line-height: 1.65;
}
.mi-table {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
}
.mi-item {
  display: flex;
  gap: var(--space-2);
}
.mi-item dt {
  flex-shrink: 0;
  width: 36px;
  margin-top: 1px;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
}
.mi-item dd {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.mi-empty {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
