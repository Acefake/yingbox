<template>
  <SettingsGroup
    title="搜索"
    footer="网盘搜索用 PanSou 聚合各频道的 115 分享，搜索关键词会发给这里填的地址。推荐在 NAS 上自部署：docker run -d -p 8888:8888 ghcr.io/fish2018/pansou，再填 http://NAS地址:8888。"
  >
    <SettingsRow title="PanSou 地址" stacked>
      <UiInput
        v-model="pansouDraft"
        aria-label="PanSou 地址"
        placeholder="http://NAS地址:8888"
        spellcheck="false"
        @change="savePansou"
      />
    </SettingsRow>
    <SettingsRow
      v-if="pansouUrl !== PANSOU_PUBLIC_URL"
      title="使用公共实例"
      :description="`第三方维护的 ${PANSOU_PUBLIC_URL}，关键词会发给它，可能限流或失效`"
    >
      <UiButton size="sm" label="使用" @click="usePublic" />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup
    title="115 账号"
    :footer="`扫码登录绑定「115生活 · 支付宝小程序」端，不会挤掉网页端和手机 App 的登录。${storageNote}`"
  >
    <SettingsRow
      v-if="account?.loggedIn"
      :title="account.userName || '已登录'"
      :description="`ID ${account.userId}`"
    >
      <UiButton size="sm" label="退出" @click="logout" />
    </SettingsRow>
    <SettingsRow
      v-else
      title="未登录"
      description="用手机 115 App 扫码"
      :stacked="Boolean(qr.qrUrl.value)"
    >
      <div v-if="qr.qrUrl.value" class="netdisk-qr">
        <img
          :src="qr.qrUrl.value"
          alt="115 登录二维码"
          class="netdisk-qr-image"
        />
        <p class="netdisk-qr-status" role="status">{{ qrHint }}</p>
        <div v-if="qrDone" class="netdisk-qr-actions">
          <UiButton
            v-if="qr.canRetry.value"
            size="sm"
            variant="primary"
            label="重试"
            @click="qr.retry"
          />
          <UiButton
            size="sm"
            label="重新获取二维码"
            :loading="qr.loading.value"
            @click="qr.start"
          />
        </div>
      </div>
      <UiButton
        v-else
        size="sm"
        icon="scan"
        label="扫码登录"
        :loading="qr.loading.value"
        @click="qr.start"
      />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup title="转存位置" footer="转存的分享整份存进这个文件夹。">
    <SettingsRow
      :title="targetName || '根目录'"
      :description="`cid ${targetCid}`"
    >
      <UiButton
        size="sm"
        :label="picking ? '收起' : '选择…'"
        :disabled="!account?.loggedIn"
        @click="picking = !picking"
      />
    </SettingsRow>
    <SettingsRow v-if="picking && account?.loggedIn" stacked>
      <NetdiskFolderPicker :start-cid="targetCid" @pick="pickFolder" />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup
    title="助手转存目标文件夹"
    footer="AI 助手和首页豆瓣卡「找 115 资源」转存的电影存进这里；不设时跟随上面的转存位置。这个文件夹要在媒体库里（CloudDrive2 挂载），转存后才能自动入库。"
  >
    <SettingsRow
      :title="movieCid ? movieName || '根目录' : '跟随转存位置'"
      :description="movieCid ? `cid ${movieCid}` : undefined"
    >
      <UiButton
        v-if="movieCid"
        size="sm"
        variant="plain"
        label="跟随转存位置"
        @click="pickMovieFolder(null)"
      />
      <UiButton
        size="sm"
        :label="pickingMovie ? '收起' : '选择…'"
        :disabled="!account?.loggedIn"
        @click="pickingMovie = !pickingMovie"
      />
    </SettingsRow>
    <SettingsRow v-if="pickingMovie && account?.loggedIn" stacked>
      <NetdiskFolderPicker
        :start-cid="movieCid || targetCid"
        @pick="pickMovieFolder"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 网盘：PanSou 地址（默认不填；公共实例需显式选用）、115 扫码登录 / 退出、转存目标文件夹，
 * 以及助手转存目标文件夹（库外发现转存电影用，空 = 跟随转存目标）。
 * 扫码与 Cookie 都在主进程，这里只显示二维码图片和账号名；扫码状态见 useQrLogin。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { toast } from '@/components/ui/toast'
import { SettingsGroup, SettingsRow, useSetting } from '@/features/settings'
import { isWebRuntime } from '@/services/library-server'
import {
  PANSOU_PUBLIC_URL,
  type Pan115Account,
  type Pan115Dir,
} from '../../../../../shared/contract/pan115'

import { netdisk } from '../api'
import { useQrLogin } from '../composables/use-qr-login'
import { errorText } from '../utils/netdisk-rules'
import NetdiskFolderPicker from './NetdiskFolderPicker.vue'

/** 登录信息存在哪：桌面端主进程加密存本机；网页端存在片库服务的数据目录（仅服务用户可读的文件） */
const storageNote = isWebRuntime()
  ? '登录信息保存在片库服务的数据目录里（仅服务用户可读）。'
  : '登录信息加密保存在本机。'

const pansouUrl = useSetting('pan115.pansouUrl')
const targetCid = useSetting('pan115.targetCid')
const targetName = useSetting('pan115.targetName')
const movieCid = useSetting('pan115.movieCid')
const movieName = useSetting('pan115.movieName')
const pickingMovie = ref(false)
const pansouDraft = ref(pansouUrl.value)

const account = ref<Pan115Account | null>(null)
const picking = ref(false)
const qr = useQrLogin({
  api: netdisk,
  onDone: next => {
    account.value = next
    toast.success('115 登录成功')
  },
  notifyError: message => toast.error(message),
})

const qrDone = computed(() =>
  ['expired', 'canceled', 'error'].includes(qr.status.value)
)
const qrHint = computed(
  () =>
    ({
      waiting: '打开 115 App 扫一扫',
      scanned: '已扫码，请在手机上确认登录',
      done: '登录成功',
      expired: '二维码已过期',
      canceled: '已取消登录',
      error: qr.error.value || '登录失败',
    })[qr.status.value]
)

function savePansou(): void {
  pansouUrl.value = pansouDraft.value.trim()
}

function usePublic(): void {
  pansouDraft.value = PANSOU_PUBLIC_URL
  savePansou()
}

async function refreshAccount(): Promise<void> {
  try {
    account.value = await netdisk().account()
  } catch (e) {
    toast.error(`读取 115 账号失败：${errorText(e)}`)
  }
}

async function logout(): Promise<void> {
  try {
    await netdisk().logout()
  } catch (e) {
    toast.error(`退出失败：${errorText(e)}`)
  }
  picking.value = false
  pickingMovie.value = false
  await refreshAccount()
}

function pickFolder(dir: Pan115Dir): void {
  targetCid.value = dir.cid
  targetName.value = dir.cid === '0' ? '' : dir.name
  picking.value = false
}

/** 选助手转存目标文件夹；null = 跟随转存位置 */
function pickMovieFolder(dir: Pan115Dir | null): void {
  movieCid.value = dir?.cid ?? ''
  movieName.value = dir && dir.cid !== '0' ? dir.name : ''
  pickingMovie.value = false
}

onMounted(refreshAccount)
onBeforeUnmount(qr.stop)
</script>

<style scoped>
.netdisk-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
}
.netdisk-qr-image {
  width: 180px;
  height: 180px;
  border-radius: var(--radius-md);
}
.netdisk-qr-actions {
  display: flex;
  gap: var(--space-2);
}
.netdisk-qr-status {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
</style>
