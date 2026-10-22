<template>
  <div class="add-dialog" @click.self="emit('close')">
    <div class="add-panel">
      <DialogTitlebar title="添加自定义源" icon="plus" @close="emit('close')" />
      <div class="add-body">
        <p class="hint">
          苹果 CMS v10 接口，例如：https://xxx.com/api.php/provide/vod
        </p>
        <label class="yb-label add-label">名称</label>
        <UiInput v-model="newName" placeholder="名称" />
        <label class="yb-label add-label">API 地址</label>
        <UiInput v-model="newApi" v-enter="addCustom" placeholder="API 地址" />
        <div class="add-actions">
          <UiButton label="取消" @click="emit('close')" />
          <UiButton
            variant="primary"
            :label="addingSource ? '分析中…' : '确认添加'"
            :loading="addingSource"
            @click="addCustom"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 添加自定义源对话框：校验名称与地址后加入 AV 源并立即检测一次。
 * 已知源（自定义 / AV）重复时只提示，不重复添加。
 */
import { toast } from '@/components/ui'
import { vEnter } from '@/directives/enter'
import { ref } from 'vue'
import DialogTitlebar from '@/components/DialogTitlebar.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { useAvSources } from '@/features/av'
import { customSites } from '../composables/cms-sites'
import { checkAvSite } from '../composables/use-source-refresh'
import { validateCustomSource } from '../utils/source-rules'

const emit = defineEmits<{ (e: 'close'): void }>()
const { allSources: avSources, addSources: addAvSources } = useAvSources()
const newName = ref('')
const newApi = ref('')
const addingSource = ref(false)

const addCustom = async (): Promise<void> => {
  if (addingSource.value) return
  const name = newName.value.trim()
  const api = newApi.value.trim()
  const problem = validateCustomSource(name, api, [
    ...customSites.value.map(site => site.api),
    ...avSources.value.map(site => site.api),
  ])
  if (problem) {
    toast[problem.level](problem.text)
    return
  }
  addingSource.value = true
  try {
    const added = addAvSources([{ name, api }])
    if (!added) throw new Error('这个数据源已经添加')
    toast.success('已加入 AV 源')
    await checkAvSite(api)
    emit('close')
    newName.value = ''
    newApi.value = ''
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : '数据源分析失败，请检查接口地址'
    )
  } finally {
    addingSource.value = false
  }
}
</script>

<style scoped>
.add-dialog {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-scrim-soft);
}
.add-panel {
  width: min(400px, calc(100vw - 48px));
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
}
.add-body {
  padding: var(--space-5);
}
.hint {
  margin: 0 0 var(--space-3);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--leading-normal);
}
.add-label {
  display: block;
  margin: var(--space-3) 0 var(--space-1);
}
.add-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
