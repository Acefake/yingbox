<template>
  <div v-if="show" class="home-setup" role="region" aria-label="开始使用">
    <p>
      {{
        nas
          ? '添加片库后，这里会出现刚入库和继续观看。也可以配置网盘。'
          : '添加片库后，这里会出现刚入库和继续观看。也可以配置在线数据源。'
      }}
    </p>
    <UiButton
      size="sm"
      variant="primary"
      icon="plus"
      label="添加片库"
      @click="addLibrary"
    />
    <UiButton
      size="sm"
      icon="database"
      :label="nas ? '配置网盘' : '配置数据源'"
      @click="openSources"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * 新用户的紧凑引导：还没有片库、继续观看和想看时，放在首页个人内容的位置。
 * 有其中任何一份数据后整条消失。添加片库走电影库的选文件夹；配置数据源打开设置里的数据源。
 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { UiButton, toast } from '@/components/ui'
import { useLibraries } from '@/features/library'
import { continueRecords } from '@/features/player'
import { watchlistEntries } from '@/features/watchlist'

import { HOME_SECTIONS } from '../utils/hero-rules'

const router = useRouter()
const nas = import.meta.env.MODE === 'nas'
const movies = useLibraries('movie')
const series = useLibraries('tv')
const records = continueRecords()
const entries = watchlistEntries()

const show = computed(() => {
  if (!movies.loaded.value) return false
  if (movies.libraries.value.length || series.libraries.value.length)
    return false
  if (records.value.some(record => HOME_SECTIONS.includes(record.section)))
    return false
  if (entries.value.length) return false
  return true
})

async function addLibrary(): Promise<void> {
  if (!movies.available) {
    void router.push('/movie')
    return
  }
  try {
    await movies.addFolder()
  } catch {
    toast.error('暂时无法添加片库')
  }
}

function openSources(): void {
  window.dispatchEvent(
    new CustomEvent('app:open-settings', {
      detail: nas ? 'netdisk' : 'sources',
    })
  )
}
</script>

<style scoped>
.home-setup {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
}
.home-setup p {
  flex: 1 1 16rem;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
</style>
