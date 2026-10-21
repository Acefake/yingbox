<template>
  <LibrarySheet
    :open="open"
    title="编辑演员资料"
    icon="edit"
    @close="emit('close')"
  >
    <form v-if="form" class="lib-actor-form" @submit.prevent="save">
      <div v-for="field in FIELDS" :key="field" class="lib-actor-form-row">
        <label :for="`actor-${field}`" class="lib-actor-form-label">
          {{ ACTOR_FIELD_LABELS[field] }}
        </label>
        <UiSelect
          v-if="field === 'gender'"
          :id="`actor-${field}`"
          v-model="form.gender"
          size="sm"
          :options="GENDER_OPTIONS"
        />
        <UiTextarea
          v-else-if="MULTILINE.has(field)"
          :id="`actor-${field}`"
          v-model="form[field]"
          autosize
          :rows="field === 'overview' ? 4 : 2"
          :placeholder="PLACEHOLDERS[field]"
        />
        <UiInput
          v-else
          :id="`actor-${field}`"
          v-model="form[field]"
          size="sm"
          :inputmode="NUMERIC.has(field) ? 'numeric' : undefined"
          :placeholder="PLACEHOLDERS[field]"
        />
        <UiIconButton
          :icon="locks.has(field) ? 'lock' : 'pin'"
          size="sm"
          :active="locks.has(field)"
          :label="
            locks.has(field)
              ? `解锁${ACTOR_FIELD_LABELS[field]}（允许自动刷新覆盖）`
              : `锁定${ACTOR_FIELD_LABELS[field]}（自动刷新不再覆盖）`
          "
          @click="toggleLock(field)"
        />
      </div>
      <p class="lib-actor-form-hint">
        改过的字段会自动锁定，之后重新获取资料时保留你的修改；点右侧图标可以解锁。
      </p>
    </form>
    <template #footer>
      <UiButton label="取消" @click="emit('close')" />
      <UiButton
        variant="primary"
        label="保存"
        :loading="saving"
        @click="save"
      />
    </template>
  </LibrarySheet>
</template>

<script setup lang="ts">
/**
 * 演员资料编辑：每个字段一行，右侧锁定开关。保存时只提交改过的字段，改过的自动加锁
 * （规则见 actor-rules.editRequest），引擎校验失败时提示原因、面板不关。
 */
import { toast } from '@/components/ui'
import { ref, watch } from 'vue'

import type { ActorDetail, ActorField } from '../../../../../shared/library/ipc'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'

import { errorText, libraryBridge } from '../api/bridge'
import LibrarySheet from '../shared/LibrarySheet.vue'
import {
  ACTOR_FIELD_LABELS,
  type ActorForm,
  editRequest,
  formOf,
} from './actor-rules'

const props = defineProps<{ open: boolean; actor: ActorDetail | null }>()
const emit = defineEmits<{ close: []; saved: [actor: ActorDetail] }>()

const FIELDS = Object.keys(ACTOR_FIELD_LABELS) as ActorField[]
const MULTILINE = new Set<ActorField>(['aliases', 'overview', 'images'])
const NUMERIC = new Set<ActorField>(['height', 'bust', 'waist', 'hip'])
const GENDER_OPTIONS = [
  { value: '', label: '未知' },
  { value: 'female', label: '女' },
  { value: 'male', label: '男' },
]
const PLACEHOLDERS: Partial<Record<ActorField, string>> = {
  aliases: '一行一个',
  birthday: 'YYYY-MM-DD',
  height: 'cm',
  bust: 'cm',
  waist: 'cm',
  hip: 'cm',
  cup: '如 E',
  images: '一行一个地址，第一个为首选头像',
}

const form = ref<ActorForm | null>(null)
const locks = ref(new Set<ActorField>())
const saving = ref(false)

watch(
  () => [props.open, props.actor?.id] as const,
  ([open]) => {
    if (!open || !props.actor) return
    form.value = formOf(props.actor)
    locks.value = new Set(props.actor.lockedFields)
  },
  { immediate: true }
)

function toggleLock(field: ActorField): void {
  const next = new Set(locks.value)
  if (next.has(field)) next.delete(field)
  else next.add(field)
  locks.value = next
}

async function save(): Promise<void> {
  const bridge = libraryBridge()
  if (!bridge || !props.actor || !form.value || saving.value) return
  const request = editRequest(props.actor, form.value, locks.value)
  if (!request) {
    emit('close')
    return
  }
  saving.value = true
  try {
    emit('saved', await bridge.actors.update(request))
    emit('close')
  } catch (e) {
    toast.error(errorText(e))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.lib-actor-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.lib-actor-form-row {
  display: grid;
  grid-template-columns: 72px 1fr auto;
  align-items: start;
  gap: var(--space-3);
}
.lib-actor-form-label {
  padding-top: var(--space-1);
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.lib-actor-form-hint {
  margin: var(--space-2) 0 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
</style>
