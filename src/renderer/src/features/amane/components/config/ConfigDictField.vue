<template>
  <div class="amane-config-dict">
    <div v-if="dictOptions.length" class="amane-config-dict-tabs">
      <UiSegmented
        size="sm"
        :label="label"
        :model-value="activeKey"
        :options="dictOptions"
        @update:model-value="selectedKey = $event"
      />
    </div>
    <div v-if="!schema['x-frozen-keys'] && !readonly" class="amane-config-add">
      <UiSelect
        v-if="keyOptions.length"
        v-model="newKey"
        :aria-label="`添加${label}`"
      >
        <option value="">选择条目…</option>
        <option
          v-for="key in keyOptions"
          :key="key"
          :value="key"
          :disabled="Object.hasOwn(objectValue, key)"
        >
          {{ text(path, `options.${key}`, key) }}
        </option>
      </UiSelect>
      <UiInput
        v-else
        v-model="newKey"
        :aria-label="`添加${label}`"
        placeholder="输入名称"
      />
      <UiIconButton
        icon="plus"
        :label="`添加${label}`"
        variant="secondary"
        :disabled="!newKey.trim() || Object.hasOwn(objectValue, newKey.trim())"
        @click="addEntry"
      />
    </div>
    <div v-if="activeKey" class="amane-config-dict-body">
      <ConfigField
        :key="activeKey"
        :schema="valueSchema"
        :root="root"
        :path="`${path}.$`"
        :dict-key="activeKey"
        :model-value="objectValue[activeKey]"
        bare
        @update:model-value="setEntry(activeKey, $event)"
      />
      <UiButton
        v-if="!schema['x-frozen-keys'] && !readonly"
        size="sm"
        icon="trash"
        label="移除此条目"
        @click="emit('update:modelValue', withoutKey(objectValue, activeKey))"
      />
    </div>
    <p v-else class="amane-muted">暂无条目</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 字典型配置（additionalProperties）：条目切换、添加（枚举键用下拉，否则手输）、移除。
 * 条目值递归交给 ConfigField。
 */
import { computed, ref } from 'vue'
import {
  type SegmentedOption,
  UiButton,
  UiIconButton,
  UiInput,
  UiSegmented,
  UiSelect,
} from '@/components/ui'
import {
  type Schema,
  type Value,
  initialValue,
  resolveSchema,
  text,
} from '../../config/config-schema'
import {
  activeDictKey,
  asObject,
  canAddKey,
  withoutKey,
} from '../../config/config-field'
import ConfigField from '../ConfigField.vue'

const props = defineProps<{
  /** 已解析（resolveSchema 过）的字段 schema */
  schema: Schema
  root: Schema
  path: string
  label: string
  readonly: boolean
  modelValue: Value
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Value] }>()
const newKey = ref(''),
  selectedKey = ref('')
const objectValue = computed(() => asObject(props.modelValue))
const valueSchema = computed(() =>
  typeof props.schema.additionalProperties === 'object'
    ? props.schema.additionalProperties
    : { type: 'string' }
)
const keyOptions = computed(
  () =>
    resolveSchema(props.schema.propertyNames || {}, props.root).enum?.map(
      String
    ) || []
)
/** 字典条目切换（UiSegmented），文字取翻译 */
const dictOptions = computed<SegmentedOption[]>(() =>
  Object.keys(objectValue.value).map(key => ({
    value: key,
    label: text(props.path, `options.${key}`, key),
  }))
)
const activeKey = computed(() =>
  activeDictKey(objectValue.value, selectedKey.value)
)

function setEntry(key: string, value: Value): void {
  emit('update:modelValue', { ...objectValue.value, [key]: value })
}

function addEntry(): void {
  const key = newKey.value.trim()
  if (!canAddKey(key, objectValue.value)) return
  setEntry(key, initialValue(valueSchema.value, props.root))
  selectedKey.value = key
  newKey.value = ''
}
</script>
