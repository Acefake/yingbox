<template>
  <SettingsGroup
    title="元数据"
    footer="中文缺片名时用原名；缺简介时先从豆瓣补，豆瓣也没有才用英文。已入库的条目在片库里刷新元数据后按新语言更新。"
  >
    <SettingsRow title="语言" description="片库、追剧日历与在线页的标题和简介">
      <UiSegmented
        v-model="metadataLanguage"
        size="sm"
        label="元数据语言"
        :options="metadataLanguageOptions"
      />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup title="TMDB">
    <SettingsRow title="Access Token" stacked>
      <template #description>
        前往
        <a
          href="https://www.themoviedb.org/settings/api"
          target="_blank"
          class="yb-link"
          >TMDB API 设置</a
        >
        获取 Read Access Token
      </template>
      <UiTextarea
        v-model="tmdbAccessToken"
        rows="3"
        class="settings-token"
        aria-label="TMDB Access Token"
        :placeholder="tokenPlaceholder"
      />
      <p
        v-if="!tmdbTokenConfigured() && !tmdbAccessToken"
        class="settings-warn"
      >
        尚未配置 Token，TMDB 搜索与刮削不可用
      </p>
      <UiButton
        v-else-if="tmdbTokenConfigured() && !tmdbAccessToken"
        size="sm"
        label="清除 Token"
        @click="clearTmdbToken"
      />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup
    title="图片质量"
    footer="写出到影片文件夹的海报、背景图与演员头像。越清晰下载越慢、占用越多空间。"
  >
    <SettingsRow v-for="row in imageRows" :key="row.key" :title="row.title">
      <UiSegmented
        v-model="row.model.value"
        size="sm"
        :label="row.title"
        :options="imageQualityOptions"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 刮削：元数据语言（scrape.metadataLanguage）、TMDB Token（密钥）、写出图片的清晰度（scrape.imageSize.*）。
 *
 * 语言与图片清晰度是普通设置，即改即存；主进程 / 片库服务把它们下发给片库引擎（shared/library/scrape-prefs.ts）。
 * TMDB Token 是密钥：只写不读，停顿 600ms 后交主进程加密保存（并下发给媒体库引擎），清除走「清除 Token」。
 */
import { computed, onBeforeUnmount } from 'vue'
import { toast } from '@/components/ui'
import UiButton from '@/components/ui/UiButton.vue'
import type { SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiTextarea from '@/components/ui/UiTextarea.vue'
import { isWebRuntime } from '@/services/library-server'

import SettingsGroup from '../ui/SettingsGroup.vue'
import SettingsRow from '../ui/SettingsRow.vue'
import {
  createTokenDraft,
  setTmdbToken,
  tmdbTokenConfigured,
} from '../tmdb-token'
import { useSetting } from '../use-setting'

const metadataLanguageOptions: SegmentedOption[] = [
  { value: 'zh-CN', label: '简体' },
  { value: 'zh-TW', label: '繁體' },
  { value: 'en-US', label: 'English' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
]
const metadataLanguage = useSetting('scrape.metadataLanguage')

const tmdbDraft = createTokenDraft(value =>
  setTmdbToken(value).then(
    () =>
      toast.success(value.trim() ? 'TMDB Token 已保存' : 'TMDB Token 已清除'),
    error => toast.error(`保存 TMDB Token 失败：${(error as Error).message}`)
  )
)
const tmdbAccessToken = computed({
  get: () => tmdbDraft.value.value,
  set: tmdbDraft.input,
})
const clearTmdbToken = tmdbDraft.clear
onBeforeUnmount(tmdbDraft.flush)
/** 网页端：令牌存在片库服务 */
const web = isWebRuntime()
const tokenPlaceholder = computed(() =>
  tmdbTokenConfigured()
    ? web
      ? '已配置（片库服务里保存的或环境变量 YINGBOX_TMDB_TOKEN，不回显）；输入新 Token 可替换'
      : '已配置（加密保存，不回显）；输入新 Token 可替换'
    : '输入 TMDB API Read Access Token（必填，无内置默认值）'
)

const imageQualityOptions: SegmentedOption[] = [
  { value: 'w342', label: '标准' },
  { value: 'w780', label: '高清' },
  { value: 'original', label: '原图' },
]
const imageRows = [
  {
    key: 'poster',
    title: '海报',
    model: useSetting('scrape.imageSize.poster'),
  },
  {
    key: 'backdrop',
    title: '背景图',
    model: useSetting('scrape.imageSize.backdrop'),
  },
  {
    key: 'actor',
    title: '演员头像',
    model: useSetting('scrape.imageSize.actor'),
  },
]
</script>

<style scoped>
.settings-token {
  resize: none;
}
.settings-warn {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
</style>
