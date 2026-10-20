<template>
  <SettingsGroup>
    <SettingsRow title="主题" description="深色 / 浅色界面，可随时切换">
      <UiSegmented
        size="sm"
        label="主题"
        :model-value="theme"
        :options="themeOptions"
        @update:model-value="setTheme"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/** 设置 · 外观：深色 / 浅色主题（由 utils/theme 持久化）。 */
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { type AppTheme, useTheme } from '@/utils/theme'

import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRow from '../ui/SettingsRow.vue'

const { theme, setTheme } = useTheme()

const themeOptions: SegmentedOption<AppTheme>[] = [
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'light', label: '浅色', icon: 'sun' },
]
</script>
