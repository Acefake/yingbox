<template>
  <SettingsGroup
    title="弹弹play 开放平台"
    footer="弹幕来自弹弹play 开放弹幕网络。AppId 和 AppSecret 需要你自己申请，只保存在本机；AppSecret 加密存放，只用于给请求签名。"
  >
    <SettingsRow title="AppId" stacked>
      <template #description>
        前往
        <a href="https://dev.dandanplay.com" target="_blank" class="yb-link"
          >弹弹play 开发者中心</a
        >
        创建应用，审核通过后获得 AppId 和 AppSecret
      </template>
      <UiInput
        v-model="appId"
        type="text"
        autocomplete="off"
        aria-label="弹弹play AppId"
        placeholder="AppId"
      />
    </SettingsRow>
    <SettingsRow title="AppSecret" stacked>
      <UiInput
        v-model="appSecret"
        type="password"
        autocomplete="off"
        aria-label="弹弹play AppSecret"
        :placeholder="
          danmakuSecretConfigured()
            ? '已配置（加密保存，不回显）；输入新的可替换'
            : 'AppSecret'
        "
      />
      <p v-if="!ready && !appSecret" class="settings-warn">
        AppId 和 AppSecret 都填好后，播放器控制栏的「弹」按钮才能加载弹幕
      </p>
      <UiButton
        v-else-if="danmakuSecretConfigured() && !appSecret"
        size="sm"
        label="清除 AppSecret"
        @click="clearSecret"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 弹幕：弹弹play AppId（普通设置 danmaku.appId）与 AppSecret（密钥 danmaku.appSecret）。
 * 弹幕外观在播放器的弹幕面板里调，同样全局记住。
 */
import { computed, onBeforeUnmount } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'

import { danmakuSecretConfigured, setDanmakuSecret } from '../danmaku-secret'
import { createTokenDraft } from '../tmdb-token'
import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import { useSetting } from '../use-setting'

const appId = useSetting('danmaku.appId')

/** AppSecret 只写不读：停顿 600ms 后交主进程加密保存，空草稿不保存，清除走按钮 */
const draft = createTokenDraft(value =>
  setDanmakuSecret(value).catch(error =>
    console.warn('[settings] 保存弹弹play AppSecret 失败', error)
  )
)
const appSecret = computed({
  get: () => draft.value.value,
  set: draft.input,
})
const clearSecret = draft.clear
onBeforeUnmount(draft.flush)

const ready = computed(
  () => danmakuSecretConfigured() && appId.value.trim() !== ''
)
</script>

<style scoped>
.settings-warn {
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
</style>
