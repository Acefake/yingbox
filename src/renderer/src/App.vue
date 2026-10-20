<template>
  <a-config-provider
    :theme="antdTheme"
    :component-size="'small'"
    :auto-insert-space-in-button="false"
  >
    <template v-if="isPlayerPopout">
      <router-view />
    </template>
    <AppLayout v-else>
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </AppLayout>
    <MpvLoadingOverlay v-if="!isPlayerPopout" />
  </a-config-provider>
</template>

<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { ConfigProvider } from 'ant-design-vue'
import type { Theme } from 'ant-design-vue/es/config-provider/context'
import { AppLayout } from '@/features/shell'
import { MpvLoadingOverlay } from '@/features/player'
import { useTheme } from '@/utils/theme'

const route = useRoute()
const isPlayerPopout = computed(() => route.name === 'PlayerPopout')

/** Ant Design 主题：随明暗切换即时更新，令牌取自 tokens.css */
const { antdTheme } = useTheme()

/**
 * message / notification / Modal.confirm 是静态方法，渲染在 <a-config-provider> 之外，
 * 拿不到上面的主题；ConfigProvider.config 写入全局配置后，它们内部的 ConfigProvider 会带上同一份主题。
 * 类型上 config 只声明了旧版 Theme 和前缀，运行时会把整个对象原样传给 ConfigProvider，所以这里做一次断言。
 * 中文按钮不自动插空格（「取消」而不是「取 消」），与 UiButton 一致。
 */
watchEffect(() => {
  ConfigProvider.config({
    theme: antdTheme.value as unknown as Theme,
    autoInsertSpaceInButton: false,
  } as Parameters<typeof ConfigProvider.config>[0])
})
</script>
