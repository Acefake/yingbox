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
    <SettingsRow
      title="降低透明度"
      :description="
        nas
          ? '侧栏、海报按钮和提示条使用实色，减少背景模糊。系统开启「降低透明度」时自动使用实色'
          : '侧栏、AI 助手、海报上的圆形按钮和提示条改用实色，不做背景模糊，低配电脑更流畅。系统开启「降低透明度」时自动使用实色'
      "
    >
      <UiSwitch v-model="reduceTransparency" label="降低透明度" />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup
    title="悬停预览"
    footer="系统开启「减少动态效果」时不自动播放。"
  >
    <SettingsRow
      title="悬停播放预览"
      description="指针停在海报上一会儿，在卡片里静音播放预告片或片段"
    >
      <UiSwitch v-model="previewEnabled" label="悬停播放预览" />
    </SettingsRow>
    <SettingsRow
      v-if="previewEnabled"
      title="等待时间"
      description="悬停多久后开始播放"
    >
      <UiSegmented
        v-model="previewDelay"
        size="sm"
        label="悬停预览等待时间"
        :options="delayOptions"
      />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup
    title="防剧透"
    footer="根据播放进度和继续播放记录判断哪些集看过。"
  >
    <SettingsRow
      title="遮住未看的剧集"
      description="剧集详情里没看过的集剧照模糊、简介折叠，鼠标悬停才显示"
    >
      <UiSwitch v-model="spoilerGuard" label="遮住未看的剧集" />
    </SettingsRow>
  </SettingsGroup>
  <SettingsGroup v-if="nas" title="片库分区">
    <SettingsRow title="成人模式" description="显示番号库入口和相关刮削设置">
      <UiSwitch v-model="adultMode" label="成人模式" />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 外观：深色 / 浅色主题与降低透明度（ui.reduceTransparency，由 utils/theme 应用到根节点），卡片悬停预览的开关与等待时间
 * （ui.hoverPreview / ui.hoverPreviewDelay，经主进程写入），防剧透开关（ui.spoilerGuard）。
 */
import { computed } from 'vue'

import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { type AppTheme, useTheme } from '@/utils/theme'

import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import { useSetting } from '../use-setting'

const { theme, setTheme } = useTheme()

const themeOptions: SegmentedOption<AppTheme>[] = [
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'light', label: '浅色', icon: 'sun' },
]

const previewEnabled = useSetting('ui.hoverPreview')
const delaySetting = useSetting('ui.hoverPreviewDelay')
const spoilerGuard = useSetting('ui.spoilerGuard')
const reduceTransparency = useSetting('ui.reduceTransparency')
const nas = import.meta.env.MODE === 'nas'
const adultMode = useSetting('app.adultMode')
/** 分段控件只认字符串：毫秒数 ↔ 字符串 */
const previewDelay = computed({
  get: () => String(delaySetting.value),
  set: value => (delaySetting.value = Number(value)),
})

const delayOptions: SegmentedOption[] = [
  { value: '300', label: '短' },
  { value: '600', label: '标准' },
  { value: '1000', label: '长' },
]
</script>
