<template>
  <UiButton
    variant="primary"
    size="lg"
    icon="plus"
    :label="jav ? '添加文件夹…' : '添加来源…'"
    @click="jav ? addFolder() : (open = true)"
  />
  <LibrarySourceSheet
    v-if="!jav"
    :open="open"
    :section="section"
    :add-local="addLocal"
    @close="open = false"
  />
</template>

<script setup lang="ts">
/**
 * 片库空状态里的主按钮：普通片库点开「添加来源」面板（本地 / 115 / WebDAV），
 * 番号库仍直接选文件夹（addFolder，由页面负责提示与报错）。
 */
import { computed, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'

import type { LibraryInfo } from '../../../../../shared/library/ipc'
import type { LibrarySection } from '../state/library-section'

import LibrarySourceSheet from './LibrarySourceSheet.vue'

const props = defineProps<{
  section: LibrarySection
  /** 番号库：直接选文件夹 */
  addFolder: () => void
  /** 普通片库：添加本地文件夹（useLibraries.addFolder），取消返回 null */
  addLocal: () => Promise<LibraryInfo | null>
}>()

const open = ref(false)
const jav = computed(() => props.section === 'jav')
</script>
