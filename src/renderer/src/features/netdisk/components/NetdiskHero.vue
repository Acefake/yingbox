<template>
  <section
    class="netdisk-hero yb-on-media"
    :class="{ 'is-matched': match }"
    aria-label="网盘搜索"
  >
    <Transition name="netdisk-hero-fade">
      <img
        :key="art"
        class="netdisk-hero-art"
        :class="{ 'is-default': art === defaultArt }"
        :src="art"
        alt=""
        referrerpolicy="no-referrer"
        @error="broken.add(art)"
      />
    </Transition>
    <div class="netdisk-hero-side" aria-hidden="true" />
    <span class="yb-pblur netdisk-hero-blur" aria-hidden="true"
      ><i /><i /><i /><i
    /></span>

    <div class="netdisk-hero-top">
      <span class="netdisk-hero-eyebrow">网盘 · 磁力</span>
      <UiButton
        class="netdisk-hero-settings"
        variant="glass"
        icon="settings"
        label="网盘设置"
        :disabled="settingsDisabled"
        @click="emit('settings')"
      />
    </div>

    <div class="netdisk-hero-copy">
      <form
        class="netdisk-hero-search"
        role="search"
        @submit.prevent="emit('search')"
      >
        <UiInput
          v-model="keyword"
          class="netdisk-hero-input"
          variant="filled"
          icon="search"
          clearable
          :disabled="disabled"
          aria-label="搜索 115 分享和磁力"
          placeholder="片名、剧名…"
        />
        <!-- UiButton 固定 type="button"：点击只走 @click，回车走表单 submit，不会一次搜两遍 -->
        <UiButton
          v-if="!match"
          variant="primary"
          size="lg"
          label="搜索"
          :loading="loading"
          :disabled="disabled || !keyword.trim()"
          @click="emit('search')"
        />
      </form>

      <template v-if="match">
        <img
          v-if="match.logo && !broken.has(match.logo)"
          class="netdisk-hero-logo"
          :src="match.logo"
          :alt="match.title"
          referrerpolicy="no-referrer"
          @error="broken.add(match.logo)"
        />
        <h1 v-else class="netdisk-hero-title is-film">{{ match.title }}</h1>
        <p class="netdisk-hero-meta">
          <template v-for="(part, index) in match.meta" :key="part">
            <span v-if="index" aria-hidden="true">·</span>
            <span>{{ part }}</span>
          </template>
          <span v-if="specs.length" class="netdisk-hero-specs">
            <UiSpecBadge
              v-for="spec in specs"
              :key="`${spec.variant}:${spec.text}`"
              v-bind="spec"
            />
          </span>
          <b v-if="match.rating" class="netdisk-hero-rating">{{
            match.rating
          }}</b>
        </p>
      </template>
      <template v-else>
        <h1 class="netdisk-hero-title">想看的，<br />一键进片库。</h1>
        <p class="netdisk-hero-lede">
          搜 115 分享和磁力。分享秒转存，磁力走 115 离线，下完自动刮削入库。
        </p>
      </template>

      <p v-if="summary" class="netdisk-hero-summary" role="status">
        找到 <b>{{ summary.shares }}</b> 个 115 分享 ·
        <b>{{ summary.magnets }}</b> 条磁力<template v-if="summary.best">
          · 最佳：{{ summary.best }}</template
        >
      </p>
      <p
        v-else-if="!match && status.length"
        class="netdisk-hero-status"
        aria-label="网盘状态"
      >
        <span v-for="item in status" :key="item.text">
          <i v-if="item.ok" class="netdisk-hero-dot" aria-hidden="true" />{{
            item.text
          }}
        </span>
      </p>

      <div v-if="match" class="netdisk-hero-actions">
        <UiButton
          variant="primary"
          size="lg"
          icon="download"
          :label="bestSaved ? '已转存' : '转存最佳版本'"
          :loading="bestSaving"
          :disabled="!canSaveBest || bestSaved"
          @click="emit('saveBest')"
        />
        <UiButton
          variant="glass"
          size="lg"
          icon="cloud"
          label="磁力离线"
          :disabled="!summary?.magnets"
          @click="emit('magnet')"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
/**
 * 网盘页顶部的海报 Hero（铺到窗口左上角，浮动侧栏与窗口键胶囊压在上面；画面区域 .yb-on-media，两套主题都是深色）。
 * - 默认：光丝云图海报、大标题与一行说明、玻璃搜索框 + 白色「搜索」，下面一行真实状态（115 登录、搜索来源、离线中任务数）；
 * - 搜索后对上一部片（match）：背景换成剧照，有标志显示标志，否则大标题片名；年份 · 类型 · 时长 + 最佳版本的规格标签 + 评分；
 *   「找到 N 个 115 分享 · M 条磁力 · 最佳：…」，主按钮「转存最佳版本」，次按钮「磁力离线」（切到磁力页签）。
 * 没对上时保持默认海报，搜索后仍显示数量行。剧照或标志加载失败时退回默认海报 / 大标题。
 * 搜索框只有一个：命中态用 CSS order 挪到最上面，输入不丢焦点。
 */
import { computed, reactive } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSpecBadge from '@/components/ui/UiSpecBadge.vue'
import type { SpecBadge } from '@/components/ui/spec-badge'
import defaultArt from '@/assets/imgs/netdisk-hero.webp'

import type { HeroMatch } from '../utils/hero-match'
import type { HeroStatusItem, HeroSummary } from '../utils/hero-status'

const props = defineProps<{
  match: HeroMatch | null
  /** 搜过之后的数量与最佳版本；还没搜为 null */
  summary: HeroSummary | null
  status: HeroStatusItem[]
  /** 最佳版本的规格标签（命中态元信息行） */
  specs: SpecBadge[]
  loading: boolean
  /** 不能搜索（没有桥或没配来源） */
  disabled: boolean
  settingsDisabled: boolean
  canSaveBest: boolean
  bestSaving: boolean
  bestSaved: boolean
}>()
const emit = defineEmits<{
  search: []
  settings: []
  saveBest: []
  magnet: []
}>()
const keyword = defineModel<string>('keyword', { required: true })

/** 加载失败的图片地址（剧照退回默认海报，标志退回大标题） */
const broken = reactive(new Set<string>())
const art = computed(() =>
  props.match && !broken.has(props.match.backdrop)
    ? props.match.backdrop
    : defaultArt
)
</script>

<style scoped src="./netdisk-hero.css"></style>
