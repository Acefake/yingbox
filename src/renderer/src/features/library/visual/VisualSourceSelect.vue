<template>
  <UiSelect v-model="visualSearchSource" aria-label="CLIP 搜索范围" size="sm">
    <option value="all">CLIP：全部</option>
    <option value="image">CLIP：仅图片</option>
    <option value="video">CLIP：仅视频（抽帧）</option>
  </UiSelect>
</template>
<script setup lang="ts">
/** 图片包括封面与剧照，视频仅包含已索引的关键帧。 */
import { UiSelect } from '@/components/ui'
import { visualSearchSource } from './visual-source'
</script>
