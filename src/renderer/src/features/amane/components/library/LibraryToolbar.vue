<template>
  <form class="amane-toolbar" @submit.prevent="emit('search')">
    <div class="amane-search">
      <UiInput
        v-model="search"
        :placeholder="searchPlaceholder(tab)"
        aria-label="搜索片库"
      />
      <UiIconButton type="submit" icon="search" label="搜索" />
    </div>
    <UiIconButton
      v-if="tab === 'films'"
      icon="filter"
      label="高级搜索"
      :active="advancedOpen"
      :aria-expanded="advancedOpen"
      @click="advancedOpen = !advancedOpen"
    />
    <div
      v-if="tab === 'films'"
      ref="sortWrapper"
      class="amane-sort"
      @keydown.esc.stop="sortOpen = false"
    >
      <UiButton
        ref="sortButton"
        class="amane-sort-button"
        icon="sort"
        aria-haspopup="menu"
        :aria-expanded="sortOpen"
        @click="sortOpen = !sortOpen"
      >
        <span>{{ sortLabel(sortField) }}</span>
        <UiIcon
          :name="sortOrder === 'asc' ? 'arrowUp' : 'arrowDown'"
          size="sm"
        />
      </UiButton>
      <div
        v-if="sortOpen"
        class="amane-sort-menu"
        role="menu"
        aria-label="排序"
      >
        <!-- 菜单项是 UiListRow：role=menuitemradio + aria-checked 透传给原生 button -->
        <UiListRow
          v-for="option in SORT_OPTIONS"
          :key="option.value"
          class="amane-sort-item"
          role="menuitemradio"
          :aria-checked="sortField === option.value"
          :selected="sortField === option.value"
          @click="choose(option.value)"
        >
          {{ option.label }}
          <template v-if="sortField === option.value" #trailing>
            <UiIcon
              :name="sortOrder === 'asc' ? 'arrowUp' : 'arrowDown'"
              size="sm"
            />
          </template>
        </UiListRow>
      </div>
    </div>
    <UiButton
      v-if="filtered"
      size="sm"
      icon="close"
      :label="`清除 ${filterLabel} 筛选`"
      @click="emit('clearFilters')"
    />
    <div v-if="tab === 'films'" class="amane-scrape">
      <UiInput
        v-model="number"
        class="number-input"
        placeholder="输入番号添加资料"
        aria-label="手动刮削番号"
      />
      <UiButton
        icon="download"
        label="刮削"
        :disabled="!number.trim() || busy"
        @click="emit('scrapeNumber')"
      />
    </div>
  </form>
</template>

<script setup lang="ts">
/**
 * 片库 / 演员 / 文件视图的工具栏：搜索、高级搜索开关、排序菜单（点外面关闭）、
 * 清除演员 / 标签筛选、手动按番号刮削。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import {
  UiButton,
  UiIcon,
  UiIconButton,
  UiInput,
  UiListRow,
} from '@/components/ui'
import {
  type AmaneTab,
  type MetadataSortField,
  SORT_OPTIONS,
  type SortOrder,
  searchPlaceholder,
  sortLabel,
} from '../../utils/library-query'

defineProps<{
  tab: AmaneTab
  sortField: MetadataSortField
  sortOrder: SortOrder
  /** 是否按演员 / 标签筛选中，以及筛选对象的名字 */
  filtered: boolean
  filterLabel: string
  busy: boolean
}>()
const search = defineModel<string>('search', { required: true })
const number = defineModel<string>('number', { required: true })
const advancedOpen = defineModel<boolean>('advancedOpen', { required: true })
const sortOpen = defineModel<boolean>('sortOpen', { required: true })
const emit = defineEmits<{
  search: []
  sort: [field: MetadataSortField]
  clearFilters: []
  scrapeNumber: []
}>()
const sortWrapper = ref<HTMLElement | null>(null),
  sortButton = ref<InstanceType<typeof UiButton> | null>(null)

/** 选排序字段后焦点回到排序按钮 */
function choose(field: MetadataSortField): void {
  emit('sort', field)
  ;(sortButton.value?.$el as HTMLButtonElement | undefined)?.focus()
}

function onSortOutside(event: MouseEvent): void {
  if (sortOpen.value && !sortWrapper.value?.contains(event.target as Node))
    sortOpen.value = false
}

onMounted(() => document.addEventListener('click', onSortOutside))
onBeforeUnmount(() => document.removeEventListener('click', onSortOutside))
</script>
