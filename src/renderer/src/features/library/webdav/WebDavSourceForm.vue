<template>
  <div class="dav-form">
    <label class="dav-form__field">
      <span class="dav-form__label">名称</span>
      <UiInput
        v-model="form.name"
        size="sm"
        placeholder="例如 客厅 NAS"
        aria-label="名称"
      />
    </label>
    <label class="dav-form__field">
      <span class="dav-form__label">地址</span>
      <UiInput
        v-model="form.url"
        size="sm"
        placeholder="http://192.168.1.5:5244/dav"
        aria-label="地址"
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <label class="dav-form__field">
      <span class="dav-form__label">用户名</span>
      <UiInput
        v-model="form.username"
        size="sm"
        placeholder="匿名访问可不填"
        aria-label="用户名"
        autocomplete="off"
      />
    </label>
    <label class="dav-form__field">
      <span class="dav-form__label">密码</span>
      <UiInput
        v-model="form.password"
        size="sm"
        type="password"
        :placeholder="passwordPlaceholder"
        aria-label="密码"
        autocomplete="new-password"
      />
    </label>
    <div class="dav-form__test">
      <UiButton
        size="sm"
        label="测试连接"
        :loading="testing"
        :disabled="Boolean(formError)"
        @click="test"
      />
      <span
        v-if="result"
        class="dav-form__result"
        :class="{ 'is-error': !result.ok }"
        role="status"
      >
        {{ result.message }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * WebDAV / Alist 源表单（放在 confirmDialog 里）：名称、地址、用户名、密码，可先测试连接。
 * 每次改动经 change 事件把表单的普通对象交给调用方（WebDavGroup），确认时由调用方保存。
 * 编辑已有源时密码留空表示不改；测试连接时主进程用已保存的密码。
 */
import { computed, reactive, ref, watch } from 'vue'

import type {
  WebDavProbe,
  WebDavSourceInfo,
} from '../../../../../shared/contract/webdav'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'

import { webdavApi } from './webdav-api'
import {
  type SourceForm,
  sourceForm,
  sourceFormError,
  sourceInput,
} from './webdav-rules'

const props = defineProps<{ source?: WebDavSourceInfo }>()
const emit = defineEmits<{ change: [form: SourceForm] }>()

const form = reactive<SourceForm>(sourceForm(props.source))
const testing = ref(false)
const result = ref<WebDavProbe | null>(null)

const formError = computed(() => sourceFormError(form))
const passwordPlaceholder = computed(() =>
  props.source?.hasPassword ? '已保存，留空不改' : '匿名访问可不填'
)

watch(
  form,
  () => {
    result.value = null
    emit('change', { ...form })
  },
  { immediate: true }
)

async function test(): Promise<void> {
  const api = webdavApi()
  if (!api || formError.value) return
  testing.value = true
  try {
    result.value = await api.test(sourceInput({ ...form }))
  } catch (error) {
    result.value = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      dirs: [],
    }
  } finally {
    testing.value = false
  }
}
</script>

<style scoped>
.dav-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  text-align: left;
}
.dav-form__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.dav-form__label {
  color: var(--text-secondary);
  font-size: var(--text-sm);
}
.dav-form__test {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.dav-form__result {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
}
.dav-form__result.is-error {
  color: var(--danger);
}
</style>
