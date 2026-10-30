<template>
  <section class="nas-page">
    <PageHeader
      title="追更与洗版"
      description="管理剧集追更、版本升级和电影上线追踪"
    />
    <AutograbTabs><AutograbPanel /></AutograbTabs>
  </section>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import { AutograbPanel } from '@/features/autograb'
import { AutograbTabs } from '@/features/autograb-upgrade'
</script>
