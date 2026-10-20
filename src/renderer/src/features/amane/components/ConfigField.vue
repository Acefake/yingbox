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
        {{ optionLabel(path, option, schema, index) }}
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
    <ConfigDictField
      v-else-if="schema.type === 'object'"
      :schema="schema"
      :root="root"
      :path="path"
      :label="label"
      :readonly="readonly"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <ConfigArrayField
      v-else-if="schema.type === 'array'"
      :schema="schema"
      :root="root"
      :path="path"
      :readonly="readonly"
      :model-value="modelValue"
      @update:model-value="emit('update:modelValue', $event)"
    />
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
/**
 * Amane 配置表单的单个字段：按 schema 渲染开关 / 下拉 / 数字 / 嵌套对象 / 字典 / 数组 / 文本。
 * 字典与数组的编辑器拆在 config/ 子组件里，纯规则在 config/config-field.ts。
 */
import { computed, useId } from 'vue'
import { UiInput, UiSelect, UiSwitch, UiTextarea } from '@/components/ui'
import {
  type Schema,
  type Value,
  resolveSchema,
  text,
} from '../config/config-schema'
import {
  asObject,
  enumValue,
  isHiddenField,
  isInlineField,
  isSecretPath,
  numberValue,
  optionLabel,
} from '../config/config-field'
import ConfigArrayField from './config/ConfigArrayField.vue'
import ConfigDictField from './config/ConfigDictField.vue'

const props = defineProps<{
  schema: Schema
  root: Schema
  path: string
  modelValue: Value
  bare?: boolean
  dictKey?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Value] }>()
const id = useId()
const schema = computed(() => resolveSchema(props.schema, props.root))
const hidden = computed(() => isHiddenField(schema.value, props.dictKey))
const readonly = computed(() => schema.value['x-readonly'] === true)
const secret = computed(() => isSecretPath(props.path))
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
const objectValue = computed(() => asObject(props.modelValue))
const inline = computed(() => isInlineField(schema.value, props.bare))

function setObject(key: string, value: Value): void {
  emit('update:modelValue', { ...objectValue.value, [key]: value })
}

function selectEnum(event: Event): void {
  const raw = (event.target as HTMLSelectElement).value
  emit('update:modelValue', enumValue(schema.value, raw))
}

function numberChanged(event: Event): void {
  const input = event.target as HTMLInputElement
  const value = numberValue(input.value, input.valueAsNumber)
  if (value !== undefined) emit('update:modelValue', value)
}
</script>
