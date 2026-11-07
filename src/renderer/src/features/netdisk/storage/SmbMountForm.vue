<template>
  <div class="smb-form">
    <p>
      共享登录由操作系统管理。Windows 先在文件资源管理器中登录 NAS；macOS /
      Linux 先挂载共享目录。
    </p>
    <label>
      <span>存储名称</span>
      <UiInput
        v-model="form.name"
        placeholder="例如 客厅 NAS"
        aria-label="存储名称"
      />
    </label>
    <label>
      <span>共享路径</span>
      <UiInput
        v-model="form.path"
        placeholder="\\NAS\Movies"
        aria-label="共享路径"
        spellcheck="false"
      />
    </label>
    <UiButton label="选择共享目录" icon="folder" size="sm" @click="choose" />
    <p v-if="error" class="smb-error" role="alert">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
/** 系统认证的 SMB 共享路径表单；只编辑名称和目录，不接收密码。 */
import { reactive, ref, watch } from 'vue'
import type { StorageMountInput } from '../../../../../shared/contract/storage'
import UiInput from '@/components/ui/UiInput.vue'
import UiButton from '@/components/ui/UiButton.vue'

const props = defineProps<{ source?: StorageMountInput }>()
const emit = defineEmits<{ change: [input: StorageMountInput] }>()
const form = reactive<StorageMountInput>({
  name: '',
  path: '',
  ...props.source,
})
const error = ref('')
watch(form, () => emit('change', { ...form }), { immediate: true })

async function choose(): Promise<void> {
  error.value = ''
  try {
    const result = await window.api.dialog.openDirectory()
    if (!result.success) throw new Error(result.error || '无法打开目录选择器')
    if (!result.canceled && result.filePaths[0]) form.path = result.filePaths[0]
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}
</script>

<style scoped>
.smb-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  text-align: left;
}
.smb-form label {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.smb-form p,
.smb-form label > span {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
}
.smb-form .smb-error {
  color: var(--danger);
}
</style>
