<template>
  <SettingsGroup
    title="搜索"
    footer="网盘搜索用 PanSou 聚合各频道的 115 分享。公共实例可能限流或失效，可以在 NAS 上自部署：docker run -d -p 8888:8888 ghcr.io/fish2018/pansou，再填 http://NAS地址:8888。"
  >
    <SettingsRow title="PanSou 地址" stacked>
      <UiInput
        v-model="pansouDraft"
        aria-label="PanSou 地址"
        placeholder="https://…"
        spellcheck="false"
        @change="savePansou"
      />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup
    title="115 账号"
    footer="扫码登录绑定「115生活 · 支付宝小程序」端，不会挤掉网页端和手机 App 的登录。登录信息加密保存在本机。"
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
      :stacked="Boolean(qrUrl)"
    >
      <div v-if="qrUrl" class="netdisk-qr">
        <img :src="qrUrl" alt="115 登录二维码" class="netdisk-qr-image" />
        <p class="netdisk-qr-status" role="status">{{ qrHint }}</p>
        <UiButton
          v-if="qrDone"
          size="sm"
          label="重新获取二维码"
          @click="startLogin"
        />
      </div>
      <UiButton
        v-else
        size="sm"
        icon="scan"
        label="扫码登录"
        :loading="qrLoading"
        @click="startLogin"
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
      <NetdiskFolderPicker @pick="pickFolder" />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 网盘：PanSou 地址、115 扫码登录 / 退出、转存目标文件夹。
 * 扫码与 Cookie 都在主进程，这里只显示二维码图片和账号名。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { toast } from '@/components/ui/toast'
import { SettingsGroup, SettingsRow, useSetting } from '@/features/settings'
import type {
  Pan115Account,
  Pan115Dir,
  Pan115LoginPoll,
} from '../../../../../shared/contract/pan115'

import { netdisk } from '../api'
import { pollLogin } from '../utils/netdisk-rules'
import NetdiskFolderPicker from './NetdiskFolderPicker.vue'

const pansouUrl = useSetting('pan115.pansouUrl')
const targetCid = useSetting('pan115.targetCid')
const targetName = useSetting('pan115.targetName')
const pansouDraft = ref(pansouUrl.value)

const account = ref<Pan115Account | null>(null)
const qrUrl = ref('')
const qrLoading = ref(false)
const qrStatus = ref<Pan115LoginPoll['status']>('waiting')
const qrError = ref('')
const picking = ref(false)
let polling: AbortController | null = null

const qrDone = computed(() =>
  ['expired', 'canceled', 'error'].includes(qrStatus.value)
)
const qrHint = computed(
  () =>
    ({
      waiting: '打开 115 App 扫一扫',
      scanned: '已扫码，请在手机上确认登录',
      done: '登录成功',
      expired: '二维码已过期',
      canceled: '已取消登录',
      error: qrError.value || '登录失败',
    })[qrStatus.value]
)

function savePansou(): void {
  pansouUrl.value = pansouDraft.value.trim()
}

async function startLogin(): Promise<void> {
  polling?.abort()
  qrLoading.value = true
  const started = await netdisk().loginStart()
  qrLoading.value = false
  if (!started.ok) {
    toast.error(started.error)
    return
  }
  qrUrl.value = started.imageUrl
  qrStatus.value = 'waiting'
  const controller = new AbortController()
  polling = controller
  const outcome = await pollLogin(() => netdisk().loginPoll(), {
    signal: controller.signal,
    onStatus: status => (qrStatus.value = status),
  })
  if (controller.signal.aborted) return
  if (outcome.status === 'done') {
    account.value = outcome.account
    qrUrl.value = ''
    toast.success('115 登录成功')
  } else if (outcome.status === 'error') qrError.value = outcome.error
}

async function logout(): Promise<void> {
  await netdisk().logout()
  account.value = await netdisk().account()
  picking.value = false
}

function pickFolder(dir: Pan115Dir): void {
  targetCid.value = dir.cid
  targetName.value = dir.cid === '0' ? '' : dir.name
  picking.value = false
}

onMounted(async () => {
  account.value = await netdisk().account()
})
onBeforeUnmount(() => polling?.abort())
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
.netdisk-qr-status {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
</style>
