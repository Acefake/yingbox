<script setup lang="ts">
import { onMounted, reactive } from 'vue'

const appInfo = reactive<{
  version: string,
}>({
  version: 'Unknown',
})

onMounted(async () => {
  try {
    if (window.api && window.api.app) {
      const result = await window.api.app.getVersion()

      if (result.success && result.data) {
        appInfo.version = result.data.version
      }
    } else {
      console.warn('API not available')
    }
  } catch (error) {
    console.error('获取应用版本信息失败:', error)
  }
})
</script>

<template>
  <div class="version-info">version: {{ appInfo.version }}</div>
</template>

<style scoped>
.version-info {
  position: fixed;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: #f5f5f5;
  border-radius: 5px;
  font-size: 11px;
  color: #888;
}
</style>
