<script setup lang="ts">
/** 「影盒」专用玻璃字标；小尺寸使用中性字面保持可读性。 */
import type { BrandColor } from '../../../../shared/brand'
import { brandWordmark } from './brand'

withDefaults(
  defineProps<{
    /** 与相邻图标相同的配色。 */
    color?: BrandColor
  }>(),
  { color: 'purple' }
)
</script>

<template>
  <span class="ui-brand-wordmark"
    ><img :src="brandWordmark(color)" alt="影盒"
  /></span>
</template>

<style scoped>
.ui-brand-wordmark {
  display: inline-flex;
  width: 2.5em;
  height: 1.15em;
  flex-shrink: 0;
}
.ui-brand-wordmark img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
:global(:root[data-theme='light']) .ui-brand-wordmark img {
  filter: brightness(0.4);
}
</style>
