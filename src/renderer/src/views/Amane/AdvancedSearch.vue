<template>
  <section class="amane-advanced" aria-label="高级搜索">
    <p class="amane-muted">在对应类型中搜索并添加筛选条件</p>
    <div class="amane-filter-grid">
      <label v-for="facet in facets" :key="facet.kind"
        >{{ facet.label }}
        <UiInput
          :value="terms[facet.kind] || ''"
          placeholder="搜索…"
          :aria-label="`搜索${facet.label}`"
          @input="
            searchFacet(facet.kind, ($event.target as HTMLInputElement).value)
          "
        />
        <UiSelect
          value=""
          :aria-label="`添加${facet.label}筛选`"
          @focus="loadFacet(facet.kind)"
          @change="choose(facet.kind, $event)"
        >
          <option value="">选择{{ facet.label }}</option>
          <option
            v-for="option in options[facet.kind] || []"
            :key="option.id"
            :value="option.id"
            :disabled="filters[facet.kind + '_id']?.includes(String(option.id))"
          >
            {{ option.name }} ({{ option.count }})
          </option>
        </UiSelect>
      </label>
      <label v-for="field in fields" :key="field.key"
        >{{ field.label }}
        <UiSelect
          :value="filters[field.key]?.[0] || ''"
          @change="
            setSingle(field.key, ($event.target as HTMLSelectElement).value)
          "
        >
          <option value="">不限</option>
          <option
            v-for="option in field.options"
            :key="option.value"
            :value="option.value"
          >
            {{ option.label }}
          </option>
        </UiSelect>
      </label>
    </div>
    <p v-if="error" role="alert" class="amane-task-error">{{ error }}</p>
    <div class="amane-filter-chips">
      <template v-for="(values, key) in filters" :key="key"
        ><UiButton
          v-for="value in values"
          :key="value"
          size="sm"
          icon="close"
          :label="filterLabel(String(key), value)"
          :aria-label="`移除筛选 ${filterLabel(String(key), value)}`"
          @click="remove(String(key), value)"
      /></template>
      <UiButton
        v-if="Object.keys(filters).length"
        variant="plain"
        size="sm"
        label="清除全部"
        @click="emit('change', {})"
      />
    </div>
  </section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, reactive, ref } from 'vue'
import { type Page, amaneRequest } from '@/api/amane'
import { UiButton, UiInput, UiSelect } from '@/components/ui'
const props = defineProps<{ filters: Record<string, string[]> }>()
const emit = defineEmits<{ change: [filters: Record<string, string[]>] }>()
const facets = [
  { kind: 'actor', label: '演员' },
  { kind: 'director', label: '导演' },
  { kind: 'tag', label: '标签' },
  { kind: 'studio', label: '制作商' },
  { kind: 'publisher', label: '发行商' },
  { kind: 'series', label: '系列' },
  { kind: 'user_tag', label: '用户标签' },
]
const yesNo = [
  { value: 'true', label: '是' },
  { value: 'false', label: '否' },
]
const fields = [
  { key: 'has_files', label: '关联文件', options: yesNo },
  { key: 'has_subtitle', label: '中字', options: yesNo },
  { key: 'uncensored', label: '无码', options: yesNo },
  {
    key: 'mosaic',
    label: '马赛克标记',
    options: [
      { value: 'censored', label: '有码' },
      { value: 'uncensored', label: '无码' },
      { value: 'cracked', label: '破解' },
      { value: 'leaked', label: '流出' },
    ],
  },
  {
    key: 'definition',
    label: '分辨率',
    options: ['8K', '4K', '1440p', '1080p', '720p', '480p', 'HD', 'SD'].map(
      value => ({ value, label: value })
    ),
  },
  {
    key: 'content_type',
    label: '类型',
    options: [
      { value: 'censored', label: '有码' },
      { value: 'uncensored', label: '无码' },
      { value: 'chinese', label: '中文' },
      { value: 'western', label: '欧美' },
      { value: 'fc2', label: 'FC2' },
      { value: 'amateur', label: '素人' },
      { value: 'hentai', label: '动画' },
    ],
  },
]
type Facet = { id: number; name: string; count: number }
const terms = reactive<Record<string, string>>({}),
  options = reactive<Record<string, Facet[]>>({}),
  names = reactive<Record<string, string>>({})
const error = ref('')
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const versions: Record<string, number> = {}
let disposed = false

async function loadFacet(kind: string): Promise<void> {
  const version = (versions[kind] = (versions[kind] || 0) + 1)
  try {
    const query = new URLSearchParams({
      limit: '40',
      offset: '0',
      search: terms[kind] || '',
    })
    const result = await amaneRequest<Page<Facet>>(`/facets/${kind}?${query}`)
    if (disposed || versions[kind] !== version) return
    options[kind] = result.items
    error.value = ''
    for (const option of result.items)
      names[`${kind}_id:${option.id}`] = option.name
  } catch (e) {
    if (!disposed && versions[kind] === version)
      error.value = (e as Error).message
  }
}

function searchFacet(kind: string, value: string): void {
  terms[kind] = value
  versions[kind] = (versions[kind] || 0) + 1
  clearTimeout(timers.get(kind))
  timers.set(
    kind,
    setTimeout(() => void loadFacet(kind), 250)
  )
}

function choose(kind: string, event: Event): void {
  const select = event.target as HTMLSelectElement,
    value = select.value,
    key = `${kind}_id`
  if (value)
    emit('change', {
      ...props.filters,
      [key]: [...new Set([...(props.filters[key] || []), value])],
    })
  select.value = ''
}

function setSingle(key: string, value: string): void {
  const next = { ...props.filters }
  if (value) next[key] = [value]
  else delete next[key]
  emit('change', next)
}

function remove(key: string, value: string): void {
  const next = { ...props.filters }
  next[key] = next[key].filter(item => item !== value)
  if (!next[key].length) delete next[key]
  emit('change', next)
}

function filterLabel(key: string, value: string): string {
  const field = fields.find(field => field.key === key)
  return (
    names[`${key}:${value}`] ||
    `${field?.label || key}：${field?.options.find(option => option.value === value)?.label || value}`
  )
}

onBeforeUnmount(() => {
  disposed = true
  for (const timer of timers.values()) clearTimeout(timer)
})
</script>
