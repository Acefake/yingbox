<template>
  <form class="amane-library-form" @submit.prevent="emit('add')">
    <h2>添加媒体库</h2>
    <div class="amane-form-group">
      <label class="amane-form-row"
        ><span>名称</span><UiInput v-model="name" placeholder="我的片库"
      /></label>
      <label class="amane-form-row">
        <span>目录</span>
        <div class="amane-form-control">
          <UiInput v-model="path" placeholder="选择存放视频的目录" required />
          <UiIconButton
            icon="folder"
            label="选择目录"
            variant="secondary"
            @click="chooseDirectory"
          />
        </div>
      </label>
      <label class="amane-form-row">
        <span>自动化</span>
        <UiSelect v-model="automation">
          <option
            v-for="(label, value) in AUTOMATION_NAMES"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </UiSelect>
      </label>
    </div>
    <div class="amane-form-footer">
      <UiButton
        type="submit"
        variant="primary"
        icon="plus"
        label="添加并扫描"
        :disabled="busy || !path.trim()"
      />
    </div>
  </form>
  <div class="amane-library-list">
    <article v-for="library in libraries" :key="library.id">
      <div>
        <h3>{{ library.name }}</h3>
        <p>{{ library.path }}</p>
        <small
          >{{ AUTOMATION_NAMES[library.automation] }} ·
          {{
            library.auto_organize ? '已开启自动整理' : '保留文件原位置'
          }}</small
        >
      </div>
      <div class="amane-actions">
        <UiIconButton
          icon="scan"
          label="扫描"
          :disabled="busy"
          @click="emit('scan', library, false)"
        />
        <UiIconButton
          icon="wand"
          label="扫描并刮削"
          :disabled="busy"
          @click="emit('scan', library, true)"
        />
        <UiIconButton
          icon="folder"
          label="整理：按模板把文件搬进子目录，并写出封面/海报"
          :disabled="busy"
          @click="emit('organize', library)"
        />
        <UiIconButton
          icon="file"
          label="查看文件"
          @click="emit('browse', library)"
        />
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
/**
 * 媒体库视图：添加媒体库表单（名称 / 目录 / 自动化）与已有媒体库列表
 * （扫描、扫描并刮削、整理、查看文件）。表单值由父级保管（切换视图后仍在）。
 */
import { UiButton, UiIconButton, UiInput, UiSelect } from '@/components/ui'
import type { AmaneLibrary } from '../../api/amane'
import { AUTOMATION_NAMES } from '../../utils/library-query'

const props = defineProps<{
  libraries: AmaneLibrary[]
  busy: boolean
  isWeb: boolean
}>()
const name = defineModel<string>('name', { required: true })
const path = defineModel<string>('path', { required: true })
const automation = defineModel<AmaneLibrary['automation']>('automation', {
  required: true,
})
const emit = defineEmits<{
  add: []
  scan: [library: AmaneLibrary, scrape: boolean]
  organize: [library: AmaneLibrary]
  browse: [library: AmaneLibrary]
}>()

async function chooseDirectory(): Promise<void> {
  if (props.isWeb || !window.api?.dialog) return
  const selected = await window.api.dialog.selectDirectory()
  if (selected) path.value = selected
}
</script>
