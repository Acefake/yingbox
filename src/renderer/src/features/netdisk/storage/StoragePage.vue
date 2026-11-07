<template>
  <div class="storage-page">
    <PageAtmosphere class="storage-atmosphere" :src="storageHero" />
    <PageHeader
      title="添加存储"
      description="连接网盘、WebDAV 或局域网共享，浏览你的影视文件。"
    >
      <template #actions>
        <UiIconButton
          icon="refresh"
          label="刷新存储"
          variant="glass"
          :loading="loading"
          @click="reload"
        />
      </template>
    </PageHeader>

    <section aria-labelledby="storage-types-title">
      <h2 id="storage-types-title" class="storage-heading">选择存储类型</h2>
      <div class="storage-types">
        <UiPressable
          v-for="type in types"
          :key="type.kind"
          class="storage-type yb-glass"
          :disabled="!type.available"
          @click="add(type.kind)"
        >
          <UiIcon :name="type.icon" class="storage-type-icon" />
          <span class="storage-type-name">{{ type.name }}</span>
          <span class="storage-type-description">{{ type.description }}</span>
          <UiIcon name="forward" class="storage-type-arrow" />
        </UiPressable>
      </div>
    </section>

    <section
      v-if="loginOpen"
      class="storage-login yb-glass"
      aria-labelledby="storage-login-title"
    >
      <div class="storage-section-bar">
        <h2 id="storage-login-title" class="storage-heading">登录 115 网盘</h2>
        <UiIconButton
          icon="close"
          label="关闭扫码登录"
          @click="loginOpen = false"
        />
      </div>
      <NetdiskLogin @done="loginOpen = false" />
    </section>

    <section aria-labelledby="storage-added-title">
      <div class="storage-section-bar">
        <h2 id="storage-added-title" class="storage-heading">
          已添加<span v-if="entries.length" class="storage-count">{{
            entries.length
          }}</span>
        </h2>
      </div>
      <p v-if="error" class="storage-error" role="alert">
        {{ error }}。请点击页头刷新重试。
      </p>
      <ul v-if="entries.length" class="storage-list">
        <li
          v-for="entry in entries"
          :key="entry.id"
          class="storage-row yb-glass"
        >
          <UiPressable
            class="storage-entry"
            :label="
              entry.kind === 'webdav'
                ? `选择 ${entry.name} 的媒体文件夹`
                : `打开 ${entry.name}`
            "
            @click="open(entry)"
          >
            <UiIcon
              :name="
                entry.kind === '115'
                  ? 'cloud'
                  : entry.kind === 'webdav'
                    ? 'globe'
                    : 'database'
              "
              class="storage-entry-icon"
            />
            <span class="storage-entry-copy">
              <span class="storage-entry-name">{{ entry.name }}</span>
              <span class="storage-entry-description">{{
                entry.description
              }}</span>
            </span>
          </UiPressable>
          <span
            v-if="!checking[entry.id]"
            class="storage-status"
            :class="{ 'is-error': checked[entry.id] === 'error' }"
            role="status"
          >
            {{
              checked[entry.id] === 'error'
                ? '连接失败'
                : checked[entry.id] === 'ok'
                  ? '连接正常'
                  : entry.kind === '115'
                    ? '已登录'
                    : '已保存'
            }}
          </span>
          <UiLoadingDots v-else label="正在检查连接" />
          <UiMenuButton
            :items="menu(entry)"
            :label="`管理 ${entry.name}`"
            icon-only
            variant="glass"
          />
        </li>
      </ul>
      <p v-else-if="!loading && !error" class="storage-empty">
        还没有添加存储。选择上方的类型开始连接。
      </p>
      <UiLoadingDots v-if="loading" label="正在读取存储" />
    </section>
  </div>
</template>

<script setup lang="ts">
/** 存储入口：115 扫码、WebDAV 源与系统认证的 SMB 共享，列表只展示实际保存的数据。 */
import { computed } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import PageAtmosphere from '@/components/PageAtmosphere.vue'
import {
  UiIcon,
  UiIconButton,
  UiLoadingDots,
  UiPressable,
} from '@/components/ui'
import UiMenuButton from '@/components/ui/UiMenuButton.vue'
import type { IconName } from '@/components/ui/icons'
import NetdiskLogin from '../components/NetdiskLogin.vue'
import { netdiskAvailable } from '../api'
import storageHero from '../storage-hero.webp'
import { type StorageEntry, useStorage } from './use-storage'
import './storage-page.css'

const {
  entries,
  loading,
  error,
  checking,
  checked,
  loginOpen,
  reload,
  add,
  open,
  menu,
  mountsAvailable,
  webdavAvailable,
} = useStorage()
const types = computed<
  Array<{
    kind: StorageEntry['kind']
    name: string
    icon: IconName
    description: string
    available: boolean
  }>
>(() => [
  {
    kind: '115',
    name: '115 网盘',
    icon: 'cloud',
    description: netdiskAvailable
      ? '使用手机 115 App 扫码登录'
      : '需要桌面端或连接片库服务',
    available: netdiskAvailable,
  },
  {
    kind: 'webdav',
    name: 'WebDAV',
    icon: 'globe',
    description: webdavAvailable
      ? '连接 WebDAV / Alist 服务'
      : '请在桌面端添加 WebDAV',
    available: webdavAvailable,
  },
  {
    kind: 'smb',
    name: 'SMB',
    icon: 'database',
    description: mountsAvailable
      ? '连接系统已登录的共享目录'
      : '请在桌面端添加网络共享',
    available: mountsAvailable,
  },
])
</script>
