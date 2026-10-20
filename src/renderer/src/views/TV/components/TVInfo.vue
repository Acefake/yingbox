<template>
  <div class="ti-root">
    <div v-if="loading" class="ti-empty">加载中...</div>
    <template v-else-if="tvInfo">
      <!-- Apple TV 式元信息行：评分 · 年份 · 状态 · 季数 · 集数 · 类型 -->
      <div class="ti-meta-row">
        <span v-if="tvInfo.rating" class="ti-rating">
          <UiIcon name="star" size="sm" filled />
          {{ Number(tvInfo.rating).toFixed(1) }}
        </span>
        <span v-if="tvInfo.year" class="ti-tag">{{ tvInfo.year }}</span>
        <span v-if="tvInfo.status" class="ti-tag">{{ tvInfo.status }}</span>
        <span v-if="tvInfo.number_of_seasons" class="ti-tag"
          >{{ tvInfo.number_of_seasons }} 季</span
        >
        <span v-if="tvInfo.number_of_episodes" class="ti-tag"
          >{{ tvInfo.number_of_episodes }} 集</span
        >
        <span
          v-for="g in (tvInfo.genre || []).slice(0, 4)"
          :key="g"
          class="ti-tag"
          >{{ g }}</span
        >
      </div>

      <!-- 操作区（由父组件提供） -->
      <slot name="actions" />

      <p v-if="tvInfo.plot" class="ti-overview">{{ tvInfo.plot }}</p>

      <dl class="ti-table">
        <div v-if="tvInfo.director" class="ti-item">
          <dt>创作者</dt>
          <dd>{{ tvInfo.director }}</dd>
        </div>
        <div v-if="tvInfo.actor && tvInfo.actor.length > 0" class="ti-item">
          <dt>演员</dt>
          <dd>{{ tvInfo.actor.slice(0, 6).join('、') }}</dd>
        </div>
        <div v-if="tvInfo.network" class="ti-item">
          <dt>播出</dt>
          <dd>{{ tvInfo.network }}</dd>
        </div>
        <div v-if="tvInfo.premiered" class="ti-item">
          <dt>首播</dt>
          <dd>{{ tvInfo.premiered }}</dd>
        </div>
      </dl>
    </template>
    <template v-else>
      <slot name="actions" />
      <div class="ti-empty">
        未找到电视剧信息，请点击"同步信息"按钮从 TMDB 获取
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 本地剧集的元信息块，视觉与在线详情页（DetailWindow）一致。
 * actions 插槽放在元信息行和简介之间。
 */
import UiIcon from '@/components/ui/UiIcon.vue'
import type { TVShowInfoType } from '@/types'

interface Props {
  tvInfo: TVShowInfoType | null
  loading: boolean
}

defineProps<Props>()
</script>

<style scoped>
.ti-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.ti-meta-row:empty {
  display: none;
}
.ti-rating {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-primary);
  font-weight: var(--font-weight-semibold);
  font-variant-numeric: tabular-nums;
}
.ti-rating .app-icon {
  color: var(--rating);
}
.ti-tag {
  white-space: nowrap;
}
.ti-rating + .ti-tag::before,
.ti-tag + .ti-tag::before {
  content: '·';
  margin-right: var(--space-2);
  color: var(--text-quaternary);
}
.ti-overview {
  max-width: 64ch;
  margin: 0 0 var(--space-5);
  color: var(--text-secondary);
  font-size: var(--text-md);
  line-height: 1.65;
}
.ti-table {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin: 0;
}
.ti-item {
  display: flex;
  gap: var(--space-2);
}
.ti-item dt {
  flex-shrink: 0;
  width: 36px;
  margin-top: 1px;
  color: var(--text-tertiary);
  font-size: var(--text-2xs);
}
.ti-item dd {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.ti-empty {
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
