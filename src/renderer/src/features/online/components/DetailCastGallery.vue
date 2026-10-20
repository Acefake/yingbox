<template>
  <!-- 演员 -->
  <div v-if="cast.length" class="dw-cast-section">
    <h4 class="dw-section-title">演员</h4>
    <div v-scroll-x class="dw-cast-list">
      <div v-for="actor in cast.slice(0, 14)" :key="actor.id" class="dw-actor">
        <img
          :src="
            actor.profile_path
              ? `https://images.tmdb.org/t/p/w185${actor.profile_path}`
              : ''
          "
          class="dw-actor-img"
          @error="onActorImgError"
        />
        <div class="dw-actor-name">{{ actor.name }}</div>
        <div class="dw-actor-char">{{ actor.character }}</div>
      </div>
    </div>
  </div>

  <!-- 图库 -->
  <div v-if="images.length" class="dw-gallery-section">
    <h4 class="dw-section-title">剧照</h4>
    <div v-scroll-x class="dw-gallery">
      <div
        v-for="(img, idx) in images.slice(0, 20)"
        :key="idx"
        class="dw-gallery-item"
        @click="emit('open', idx)"
      >
        <img
          :src="`https://images.tmdb.org/t/p/w500${img.file_path}`"
          class="dw-gallery-img"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 在线详情页的演员条（最多 14 位）与剧照条（最多 20 张，点击打开灯箱）。
 * 多根节点组件，两段各自在没有数据时不渲染。
 */
defineProps<{ cast: any[]; images: any[] }>()
const emit = defineEmits<{ (e: 'open', index: number): void }>()

const onActorImgError = (e: Event): void => {
  ;(e.target as HTMLImageElement).src =
    'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><circle cx="30" cy="30" r="30" fill="%23374151"/></svg>'
}
</script>

<style scoped>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.dw-section-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 12px;
}

.dw-cast-section {
  margin-bottom: 28px;
}

.dw-cast-list {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.dw-cast-list::-webkit-scrollbar {
  height: 3px;
}

.dw-cast-list::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
}

.dw-actor {
  flex-shrink: 0;
  width: 76px;
  text-align: center;
}

.dw-actor-img {
  width: 72px;
  height: 72px;
  margin-bottom: var(--space-2);
  border-radius: 50%;
  object-fit: cover;
  background: var(--bg-fill-secondary);
}

.dw-actor-name {
  font-size: var(--text-2xs);
  color: var(--text-primary);
  line-height: 1.3;
}

.dw-actor-char {
  font-size: var(--text-2xs);
  color: var(--text-tertiary);
  margin-top: 2px;
}

/* 图库 */
.dw-gallery-section {
  margin-bottom: 28px;
}

.dw-gallery {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 8px;
}

.dw-gallery::-webkit-scrollbar {
  height: 3px;
}

.dw-gallery::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
}

.dw-gallery-item {
  flex-shrink: 0;
  width: 200px;
  height: 112px;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  transition:
    transform 0.15s,
    box-shadow 0.15s;
  border: 1px solid var(--border-subtle);
}

.dw-gallery-item:hover {
  transform: scale(1.03);
  box-shadow: var(--shadow-md);
}

.dw-gallery-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
