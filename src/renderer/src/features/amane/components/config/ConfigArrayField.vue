<template>
  <div v-if="itemSchema.enum && !schema['x-ordered']" class="amane-config-checks">
    <UiCheckbox
      v-for="(option, index) in itemSchema.enum"
      :key="String(option)"
      :model-value="arrayValue.includes(option)"
      :disabled="readonly"
      :label="
        text(
          path,
          `options.${option}`,
          optionLabel(`${path}.$`, option, itemSchema, index)
        )
      "
      @update:model-value="emit('update:modelValue', toggleItem(arrayValue, option))"
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
            `${path}.$`,
            item,
            itemSchema,
            itemSchema.enum.indexOf(item)
          )
        }}</span>
        <ConfigField
          v-else
          :schema="itemSchema"
          :root="root"
          :path="`${path}.$`"
          :model-value="item"
          bare
          @update:model-value="
            emit('update:modelValue', replaceAt(arrayValue, index, $event))
          "
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
            @click="
              emit(
                'update:modelValue',
                arrayValue.filter((_, at) => index !== at)
              )
            "
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
        :label="optionLabel(`${path}.$`, option, itemSchema, index)"
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

<script setup lang="ts">
/**
 * 数组型配置：枚举且无序 → 多选框；否则逐项编辑（x-ordered 时可拖拽 / 上下移），
 * 枚举项从「可添加」按钮里追加，其余类型追加默认值。条目值递归交给 ConfigField。
 */
import { computed, ref } from 'vue'
import { UiButton, UiCheckbox, UiIconButton } from '@/components/ui'
import {
  type Schema,
  type Value,
  initialValue,
  resolveSchema,
  text,
} from '../../config/config-schema'
import {
  asArray,
  moveItem,
  optionLabel,
  replaceAt,
  toggleItem,
} from '../../config/config-field'
import ConfigField from '../ConfigField.vue'

const props = defineProps<{
  /** 已解析（resolveSchema 过）的字段 schema */
  schema: Schema
  root: Schema
  path: string
  readonly: boolean
  modelValue: Value
}>()
const emit = defineEmits<{ 'update:modelValue': [value: Value] }>()
const dragIndex = ref(-1)
const arrayValue = computed(() => asArray(props.modelValue))
const itemSchema = computed(() =>
  resolveSchema(props.schema.items || {}, props.root)
)

function move(from: number, to: number): void {
  if (props.readonly) return
  const next = moveItem(arrayValue.value, from, to)
  if (!next) return
  emit('update:modelValue', next)
  dragIndex.value = -1
}
</script>
