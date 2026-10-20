<template>
  <SettingsGroup footer="尺寸越大越清晰，但下载更慢、占用更多空间。">
    <SettingsRow
      v-for="row in rows"
      :key="row.key"
      :title="row.title"
      :description="row.description"
    >
      <UiSegmented
        v-model="row.model.value"
        size="sm"
        :label="row.title"
        :options="imageSizeOptions"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 图片质量：海报 / 背景图 / 演员头像的 TMDB 下载尺寸（scrape.imageSize.*）。
 */
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'

import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import { useSetting } from '../use-setting'

const imageSizeOptions: SegmentedOption[] = [
  { value: 'w342', label: '小', title: '小 (w342)' },
  { value: 'w780', label: '中', title: '中 (w780)' },
  { value: 'original', label: '原图', title: '原图' },
]

const rows = [
  {
    key: 'poster',
    title: '海报',
    description: '影片封面图的下载尺寸',
    model: useSetting('scrape.imageSize.poster'),
  },
  {
    key: 'backdrop',
    title: '背景图',
    description: '详情页背景的下载尺寸',
    model: useSetting('scrape.imageSize.backdrop'),
  },
  {
    key: 'actor',
    title: '演员',
    description: '演员头像的下载尺寸',
    model: useSetting('scrape.imageSize.actor'),
  },
]
</script>
