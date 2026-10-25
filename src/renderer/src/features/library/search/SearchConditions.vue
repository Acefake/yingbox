<template>
  <div v-if="chips.length" class="search-conditions" aria-label="搜索条件">
    <span v-for="chip in chips" :key="chip.key" class="search-condition">
      <UiInput
        v-if="editing === chip.key"
        v-model="draft"
        v-enter="() => commit(chip)"
        size="sm"
        :aria-label="`修改${chip.name}`"
        :invalid="invalid"
      />
      <UiChip
        v-else
        :label="`${chip.name} ${chip.label}`"
        selected
        @click="edit(chip)"
      />
      <UiIconButton
        icon="close"
        size="sm"
        :label="`移除${chip.name}`"
        @click="emit('update:modelValue', removeChip(modelValue, chip))"
      />
    </span>
  </div>
</template>
<script setup lang="ts">
/** 统一搜索复用海报墙条件胶囊的增删改规则。 */
import { computed, ref } from 'vue'
import { UiChip, UiIconButton, UiInput } from '@/components/ui'
import { vEnter } from '@/directives/enter'
import {
  type NlChip,
  editChip,
  nlChips,
  removeChip,
  toggleChip,
} from '../nl-search/nl-chips'
import type { NlFilter } from '../nl-search/nl-filter'
import type { SearchScope } from './types'
const props = defineProps<{ modelValue: NlFilter; scope: SearchScope }>()
const emit = defineEmits<{ 'update:modelValue': [value: NlFilter] }>()
const editing = ref('')
const draft = ref('')
const invalid = ref(false)
const chips = computed(() =>
  nlChips(
    props.modelValue,
    props.scope === 'all'
      ? props.modelValue.type === 'series'
        ? 'tv'
        : 'movie'
      : props.scope
  )
)

function edit(chip: NlChip): void {
  if (chip.edit === 'toggle')
    emit('update:modelValue', toggleChip(props.modelValue, chip))
  else if (chip.edit === 'text') {
    editing.value = chip.key
    draft.value = chip.draft
    invalid.value = false
  }
}

function commit(chip: NlChip): void {
  const next = editChip(props.modelValue, chip, draft.value)
  if (!next) {
    invalid.value = true
    return
  }
  editing.value = ''
  emit('update:modelValue', next)
}
</script>
<style scoped>
.search-conditions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.search-condition {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}
</style>
