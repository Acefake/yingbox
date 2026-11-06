<template>
  <section class="cal-section" aria-labelledby="cal-settled-title">
    <div class="cal-section-head">
      <h2 id="cal-settled-title" class="cal-section-title">已入库</h2>
      <span class="cal-section-meta">{{ count }} 部剧</span>
      <UiButton
        size="sm"
        variant="plain"
        :label="open ? '收起' : '展开'"
        :aria-expanded="open"
        @click="open = !open"
      />
    </div>
    <ul v-if="open" class="cal-grid">
      <li v-for="group in rows" :key="group.id">
        <slot name="row" :group="group" />
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * 周视图底部「已入库」：本周每集都已有本地文件、没有追更动作的剧，从七天的格子里收到这里，默认折叠，点开才列出各行。
 * 行怎么画由调用方的 row 插槽决定（和周视图、列表视图同一个 CalendarRow）。
 */
import { ref } from 'vue'

import { UiButton } from '@/components/ui'

import type { ShowDayGroup } from '../calendar-rows'

defineProps<{
  rows: readonly ShowDayGroup[]
  /** 收起了几部剧 */
  count: number
}>()

const open = ref(false)
</script>
