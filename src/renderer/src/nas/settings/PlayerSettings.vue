<template>
  <SettingsGroup
    title="浏览器播放"
    footer="支持的编码和音轨取决于当前浏览器。外挂字幕由片库服务读取并转换。"
  >
    <SettingsRow
      title="自动跳过片头"
      description="使用已保存的片头标记，播放时自动跳过"
    >
      <UiSwitch v-model="skipIntro" label="自动跳过片头" />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { SettingsGroup, SettingsRow, useSetting } from '@/features/settings'
const skipIntro = useSetting('player.autoSkipIntro')
</script>
