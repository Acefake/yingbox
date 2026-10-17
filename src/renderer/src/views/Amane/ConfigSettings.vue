<template>
  <div class="amane-config-settings" :class="{ 'is-integrated': integrated }">
    <p v-if="loading" role="status">正在读取 Amane 设置…</p>
    <div v-if="error" role="alert" class="amane-error">{{ error }} <button v-if="!schema" type="button" @click="load">重试</button></div>
    <template v-if="schema && draft && baseline">
      <nav v-if="!integrated" class="amane-settings-nav" aria-label="设置分组">
        <button v-for="key in sections" :key="key" type="button" :disabled="saving || upscaling" :class="{ active: section === key }" :aria-current="section === key ? 'page' : undefined" @click="section = key">{{ sectionLabel(key) }}<span v-if="isDirty(key)" aria-label="未保存"> •</span></button>
      </nav>
      <form class="amane-config-panel" @submit.prevent="save">
        <PageHeader :title="sectionLabel(section)" as="h2" />
        <p v-if="section === 'watermark'" class="amane-muted">水印在整理影片、写出封面和海报时添加，根据关联视频的字幕、清晰度等信息生成。修改后需重新整理；片库显示的原始图片不会被覆盖。</p>
        <div v-if="section === 'sr'">
          <p class="amane-muted">“刮削时超分”仅处理后续刮削下载且低于尺寸、文件大小阈值的图片。已有图片需手动提交超分任务；首次执行会下载超分工具。</p>
          <button type="button" class="yb-btn-soft" :disabled="dirty || saving || upscaling" @click="upscale">{{ upscaling ? '提交中…' : '超分已有图片（最多 200 张）' }}</button>
          <p v-if="dirty" class="amane-muted">请先保存全部更改，再按已保存的设置处理图片。</p>
          <p v-if="taskMessage" role="status">{{ taskMessage }}</p>
        </div>
        <fieldset :disabled="saving">
          <ConfigField v-for="(field, key) in sectionFields" :key="`${section}.${key}`" :schema="field" :root="schema" :path="`${section}.${key}`" :model-value="sectionValues[key] ?? null" @update:model-value="setField(String(key), $event)" />
        </fieldset>
        <div class="amane-config-save">
          <span role="status">{{ dirty ? '有未保存的更改，将保存所有分组' : savedMessage }}</span>
          <button type="button" class="yb-btn-soft" :disabled="!dirty || saving" @click="reset">撤销全部更改</button>
          <button type="submit" class="yb-btn-primary" :disabled="!dirty || saving">{{ saving ? '保存中…' : '保存全部设置' }}</button>
        </div>
      </form>
    </template>
  </div>
</template>
<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { amaneRequest } from '@/api/amane'
import ConfigField from './ConfigField.vue'
import { clone, configPatch, resolveSchema, sectionLabel, type Config, type Schema, type Value } from './config-schema'
const schema = shallowRef<Schema | null>(null), draft = shallowRef<Config | null>(null), baseline = shallowRef<Config | null>(null)
const props = defineProps<{ initialSection?: string; integrated?: boolean }>()
const emit = defineEmits<{ sections: [sections: string[]] }>()
const section = ref(props.initialSection || 'scraping'), loading = ref(false), saving = ref(false), error = ref(''), savedMessage = ref('')
const upscaling = ref(false), taskMessage = ref('')
let disposed = false
const sections = computed<string[]>(() => {
  const current = schema.value
  if (!current?.properties) return []
  return Object.entries(current.properties)
    .filter(([, field]) => !resolveSchema(field, current)['x-hidden'])
    .map(([key]) => key)
})
watch(() => props.initialSection, value => {
  if (value && sections.value.includes(value)) section.value = value
})
const sectionSchema = computed<Schema>(() => {
  const current = schema.value
  if (!current?.properties) return {}
  const target = current.properties[section.value]
  if (!target) return {}
  return resolveSchema(target, current)
})
const sectionFields = computed<Record<string, Schema>>(() => sectionSchema.value.properties || {})
const sectionValues = computed<Record<string, Value>>(() => draft.value?.[section.value] || {})
const isDirty = (key: string): boolean => JSON.stringify(draft.value?.[key]) !== JSON.stringify(baseline.value?.[key])
const dirty = computed(() => sections.value.some(isDirty))
function canLeave(): boolean { return !saving.value && !upscaling.value && (!dirty.value || window.confirm('设置尚未保存，确定放弃更改并离开？')) }
defineExpose({ canLeave })
async function load(): Promise<void> {
  loading.value = true; error.value = ''
  try {
    const [definition, values] = await Promise.all([amaneRequest<Schema>('/config/schema'), amaneRequest<Config>('/config')])
    if (disposed) return
    schema.value = definition; baseline.value = clone(values); draft.value = clone(values)
    if (!sections.value.includes(section.value)) section.value = sections.value[0] || ''
    emit('sections', sections.value)
  } catch (e) { if (!disposed) error.value = (e as Error).message }
  finally { if (!disposed) loading.value = false }
}
function setField(key: string, value: Value): void { if (draft.value) { draft.value = { ...draft.value, [section.value]: { ...sectionValues.value, [key]: value } }; savedMessage.value = '' } }
function reset(): void { if (baseline.value) draft.value = clone(baseline.value); error.value = ''; savedMessage.value = '' }
async function save(): Promise<void> {
  if (!schema.value || !draft.value || !baseline.value || saving.value || !dirty.value) return
  const patch = configPatch(draft.value, baseline.value, schema.value)
  saving.value = true; error.value = ''
  try {
    const result = await amaneRequest<Config>('/config', 'PATCH', patch)
    if (disposed) return
    baseline.value = clone(result); draft.value = clone(result); savedMessage.value = '全部设置已保存，后续任务使用新设置'
  } catch (e) { if (!disposed) error.value = (e as Error).message }
  finally { if (!disposed) saving.value = false }
}
async function upscale(): Promise<void> {
  if (dirty.value || saving.value || upscaling.value) return
  upscaling.value = true; error.value = ''; taskMessage.value = ''
  try {
    await amaneRequest('/tasks', 'POST', { type: 'upscale', limit: 200 })
    if (!disposed) taskMessage.value = '已加入超分队列，请到“任务”查看成功、跳过或失败数量。处理完成后刷新片库。'
  } catch (e) { if (!disposed) error.value = (e as Error).message }
  finally { if (!disposed) upscaling.value = false }
}
onBeforeRouteLeave(canLeave)
onMounted(() => void load())
onBeforeUnmount(() => { disposed = true })
</script>
