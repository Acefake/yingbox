<template>
  <SettingsRow title="mpv 播放器" :description="description">
    <UiButton
      v-if="state === 'missing' && installable"
      size="sm"
      icon="download"
      :label="installing ? '下载中…' : '下载 mpv'"
      :loading="installing"
      @click="install"
    />
  </SettingsRow>
</template>

<script setup lang="ts">
/**
 * 设置 · 播放器：mpv 是否可用。找不到时 Windows 给「下载 mpv」（便携版，约 30 MB，装到用户目录），
 * 其他平台给安装命令；首次用 mpv 播放时也会自动下载，这里只是提前装好 / 失败后重试。
 */
import { computed, onMounted, ref } from 'vue'
import { toast } from '@/components/ui'
import UiButton from '@/components/ui/UiButton.vue'
import SettingsRow from '../ui/SettingsRow.vue'

const state = ref<'checking' | 'ready' | 'missing'>('checking')
const installable = ref(false)
const installing = ref(false)

const description = computed(() => {
  if (state.value === 'checking') return '正在检测…'
  if (state.value === 'ready') return '已就绪'
  if (installable.value)
    return '未检测到 mpv。首次用 mpv 播放时会自动下载便携版（约 30 MB），也可以现在下载'
  return navigator.userAgent.includes('Mac')
    ? '未检测到 mpv，请先安装：brew install mpv；找不到时会自动改用内置播放器'
    : '未检测到 mpv，请先安装（如 sudo apt install mpv）；也可用环境变量 YINGBOX_MPV_PATH 指定路径'
})

/** 问主进程 mpv 在不在 */
const probe = async (): Promise<void> => {
  const res = await window.api?.mpv?.probe().catch(() => null)
  state.value = res?.available ? 'ready' : 'missing'
  installable.value = Boolean(res?.installable)
}

const install = async (): Promise<void> => {
  if (installing.value) return
  installing.value = true
  try {
    const res = await window.api.mpv.install()
    if (res.success) toast.success('mpv 已就绪')
    else toast.error(res.error || 'mpv 下载失败')
    await probe()
  } finally {
    installing.value = false
  }
}

onMounted(() => void probe())
</script>
