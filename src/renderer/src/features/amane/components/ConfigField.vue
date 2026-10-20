<template>
  <div
    v-if="!hidden"
    class="amane-config-field"
    :class="{ 'is-boolean': schema.type === 'boolean', 'is-inline': inline }"
  >
    <div v-if="!bare" class="amane-config-caption">
      <label :for="id">{{ label }}</label>
      <p v-if="description">{{ description }}</p>
    </div>
    <template v-if="schema.type === 'boolean'">
      <UiSwitch
        :id="id"
        :label="label"
        :model-value="modelValue === true"
        :disabled="readonly"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
    <UiSelect
      v-else-if="schema.enum"
      :id="id"
      :aria-label="label"
      :disabled="readonly"
      :value="modelValue == null ? '' : String(modelValue)"
      @change="selectEnum($event)"
    >
      <option v-if="schema.nullable" value="">不设置</option>
      <option
        v-for="(option, index) in schema.enum"
        :key="String(option)"
        :value="String(option)"
      >
        {{ optionLabel(option, schema, index) }}
      </option>
    </UiSelect>
    <UiInput
      v-else-if="schema.type === 'number' || schema.type === 'integer'"
      :id="id"
      :aria-label="label"
      type="number"
      :value="modelValue ?? ''"
      :min="schema.minimum ?? schema.exclusiveMinimum"
      :max="schema.maximum ?? schema.exclusiveMaximum"
      :step="schema.type === 'integer' ? 1 : 'any'"
      :required="!schema.nullable"
      :disabled="readonly"
      @input="numberChanged($event)"
    />
    <template v-else-if="schema.type === 'object' && schema.properties">
      <div class="amane-config-nested">
        <ConfigField
          v-for="(child, key) in schema.properties"
          :key="key"
          :schema="child"
          :root="root"
          :path="`${path}.${key}`"
          :dict-key="dictKey"
          :model-value="objectValue[key] ?? null"
          @update:model-value="setObject(String(key), $event)"
        />
      </div>
    </template>
    <template v-else-if="schema.type === 'object'">
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
        <div
          v-if="!schema['x-frozen-keys'] && !readonly"
          class="amane-config-add"
        >
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
            :disabled="
              !newKey.trim() || Object.hasOwn(objectValue, newKey.trim())
            "
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
            @update:model-value="setObject(activeKey, $event)"
          />
          <UiButton
            v-if="!schema['x-frozen-keys'] && !readonly"
            size="sm"
            icon="trash"
            label="移除此条目"
            @click="deleteEntry(activeKey)"
          />
        </div>
        <p v-else class="amane-muted">暂无条目</p>
      </div>
    </template>
    <template v-else-if="schema.type === 'array'">
      <div
        v-if="itemSchema.enum && !schema['x-ordered']"
        class="amane-config-checks"
      >
        <UiCheckbox
          v-for="(option, index) in itemSchema.enum"
          :key="String(option)"
          :model-value="arrayValue.includes(option)"
          :disabled="readonly"
          :label="
            text(
              path,
              `options.${option}`,
              optionLabel(option, itemSchema, index, `${path}.$`)
            )
          "
          @update:model-value="toggleOption(option)"
        />
      </div>
      <template v-else>
        <div class="amane-config-array">
          <div
            v-for="(item, index) in arrayValue"
            :key="index"
            class="amane-config-array-item"
            :draggable="schema['x-ordered'] === true && !readonly"
            @dragstart.stop="dragIndex = index"
            @dragover.prevent
            @drop.prevent.stop="move(dragIndex, index)"
          >
            <span v-if="itemSchema.enum" class="amane-config-chip">{{
              optionLabel(
                item,
                itemSchema,
                itemSchema.enum.indexOf(item),
                `${path}.$`
              )
            }}</span>
            <ConfigField
              v-else
              :schema="itemSchema"
              :root="root"
              :path="`${path}.$`"
              :model-value="item"
              bare
              @update:model-value="setArray(index, $event)"
            />
            <div v-if="!readonly" class="amane-config-item-actions">
              <UiIconButton
                v-if="schema['x-ordered']"
                icon="back"
                size="sm"
                :label="`上移第 ${index + 1} 项`"
                :disabled="index === 0"
                @click="move(index, index - 1)"
              />
              <UiIconButton
                v-if="schema['x-ordered']"
                icon="forward"
                size="sm"
                :label="`下移第 ${index + 1} 项`"
                :disabled="index === arrayValue.length - 1"
                @click="move(index, index + 1)"
              />
              <UiIconButton
                icon="close"
                size="sm"
                :label="`移除第 ${index + 1} 项`"
                @click="removeArray(index)"
              />
            </div>
          </div>
        </div>
        <div v-if="itemSchema.enum && !readonly" class="amane-config-available">
          <UiButton
            v-for="(option, index) in itemSchema.enum.filter(
              option => !arrayValue.includes(option)
            )"
            :key="String(option)"
            size="sm"
            icon="plus"
            :label="optionLabel(option, itemSchema, index, `${path}.$`)"
            @click="emit('update:modelValue', [...arrayValue, option])"
          />
        </div>
        <UiButton
          v-else-if="!readonly"
          size="sm"
          icon="plus"
          label="添加条目"
          @click="
            emit('update:modelValue', [
              ...arrayValue,
              initialValue(itemSchema, root),
            ])
          "
        />
      </template>
    </template>
    <UiTextarea
      v-else-if="schema['x-long']"
      :id="id"
      :aria-label="label"
      rows="5"
      :maxlength="schema.maxLength"
      :readonly="readonly"
      :value="String(modelValue ?? '')"
      @input="
        emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)
      "
    />
    <UiInput
      v-else
      :id="id"
      :aria-label="label"
      :type="secret ? 'password' : 'text'"
      :autocomplete="secret ? 'new-password' : 'off'"
      :value="String(modelValue ?? '')"
      :maxlength="schema.maxLength"
      :minlength="schema.minLength"
      :pattern="schema.pattern"
      :readonly="readonly"
      @input="
        emit('update:modelValue', ($event.target as HTMLInputElement).value)
      "
    />
  </div>
</template>
<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import {
  type SegmentedOption,
  UiButton,
  UiCheckbox,
  UiIconButton,
  UiInput,
  UiSegmented,
  UiSelect,
  UiSwitch,
  UiTextarea,
} from '@/components/ui'
import {
  type Schema,
  type Value,
  initialValue,
  resolveSchema,
  text,
} from '../config/config-schema'
const props = defineProps<{
  schema: Schema
  root: Schema
  path: string
  modelValue: Value
  bare?: boolean
  dictKey?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Value] }>()
const id = useId(),
  newKey = ref(''),
  selectedKey = ref(''),
  dragIndex = ref(-1)
const schema = computed(() => resolveSchema(props.schema, props.root))
const hidden = computed(
  () =>
    schema.value['x-hidden'] ||
    (Array.isArray(schema.value['x-visible-keys']) &&
      props.dictKey &&
      !(schema.value['x-visible-keys'] as string[]).includes(props.dictKey))
)
const readonly = computed(() => schema.value['x-readonly'] === true)
const secret = computed(() =>
  /(?:^|\.)(?:api_key|api_token|password|cookie|dsn)(?:\.|$)/.test(props.path)
)
const label = computed(() =>
  text(
    props.path,
    'label',
    schema.value.title || props.path.split('.').pop() || ''
  )
)
const description = computed(() =>
  text(props.path, 'description', schema.value.description || '')
)
const objectValue = computed<Record<string, Value>>(() =>
  props.modelValue &&
  typeof props.modelValue === 'object' &&
  !Array.isArray(props.modelValue)
    ? props.modelValue
    : {}
)
const arrayValue = computed<Value[]>(() =>
  Array.isArray(props.modelValue) ? props.modelValue : []
)
const valueSchema = computed(() =>
  typeof schema.value.additionalProperties === 'object'
    ? schema.value.additionalProperties
    : { type: 'string' }
)
const itemSchema = computed(() =>
  resolveSchema(schema.value.items || {}, props.root)
)
const keyOptions = computed(
  () =>
    resolveSchema(schema.value.propertyNames || {}, props.root).enum?.map(
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
/**
 * 单值字段（开关、枚举、数字、短文本）用系统设置式的一行：标题在左、控件在右；
 * 嵌套对象、字典、数组和长文本仍然上下排列。
 */
const inline = computed(
  () =>
    !props.bare &&
    !schema.value['x-long'] &&
    (schema.value.type === 'boolean' ||
      Boolean(schema.value.enum) ||
      ['number', 'integer', 'string'].includes(schema.value.type || ''))
)
const activeKey = computed(() =>
  Object.hasOwn(objectValue.value, selectedKey.value)
    ? selectedKey.value
    : Object.keys(objectValue.value)[0] || ''
)

function optionLabel(
  value: Value,
  node: Schema,
  index: number,
  path = props.path
): string {
  return text(
    path,
    `options.${value}`,
    (node['x-show-names'] as string[] | undefined)?.[index] || String(value)
  )
}

function setObject(key: string, value: Value): void {
  emit('update:modelValue', { ...objectValue.value, [key]: value })
}

function addEntry(): void {
  const key = newKey.value.trim()
  if (
    !key ||
    ['__proto__', 'prototype', 'constructor'].includes(key) ||
    Object.hasOwn(objectValue.value, key)
  )
    return
  setObject(key, initialValue(valueSchema.value, props.root))
  selectedKey.value = key
  newKey.value = ''
}

function deleteEntry(key: string): void {
  const next = { ...objectValue.value }
  delete next[key]
  emit('update:modelValue', next)
}

function setArray(index: number, value: Value): void {
  const next = [...arrayValue.value]
  next[index] = value
  emit('update:modelValue', next)
}

function removeArray(index: number): void {
  emit(
    'update:modelValue',
    arrayValue.value.filter((_, at) => index !== at)
  )
}

function move(from: number, to: number): void {
  if (
    readonly.value ||
    from < 0 ||
    to < 0 ||
    from >= arrayValue.value.length ||
    to >= arrayValue.value.length
  )
    return
  const next = [...arrayValue.value]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  emit('update:modelValue', next)
  dragIndex.value = -1
}

function toggleOption(option: Value): void {
  emit(
    'update:modelValue',
    arrayValue.value.includes(option)
      ? arrayValue.value.filter(item => item !== option)
      : [...arrayValue.value, option]
  )
}

function selectEnum(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  emit(
    'update:modelValue',
    value === '' && schema.value.nullable
      ? null
      : (schema.value.enum?.find(option => String(option) === value) ?? value)
  )
}

function numberChanged(event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.value === '') emit('update:modelValue', null)
  else if (Number.isFinite(input.valueAsNumber))
    emit('update:modelValue', input.valueAsNumber)
}
</script>
