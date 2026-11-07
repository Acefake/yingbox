<template>
  <div class="netdisk-login">
    <div class="netdisk-login-panel">
      <p class="netdisk-login-note">{{ storageNote }}</p>
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
        variant="primary"
        label="扫码登录"
        :loading="qr.loading.value"
        @click="qr.start"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 存储页内的 115 扫码面板；成功后更新全局账号并通知父级关闭面板。
 */
import { computed, onBeforeUnmount } from 'vue'

import UiButton from '@/components/ui/UiButton.vue'
import { toast } from '@/components/ui/toast'
import { isWebRuntime } from '@/services/library-server'

import { netdisk, setNetdiskAccount } from '../api'
import { useQrLogin } from '../composables/use-qr-login'

const emit = defineEmits<{ done: [] }>()

const storageNote = isWebRuntime()
  ? '登录信息保存在片库服务的数据目录里（仅服务用户可读）。'
  : '登录信息加密保存在本机。扫码绑定「115生活 · 支付宝小程序」端，不会挤掉网页端和手机 App 的登录。'

const qr = useQrLogin({
  api: netdisk,
  onDone: next => {
    setNetdiskAccount(next)
    toast.success('115 登录成功')
    emit('done')
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

onBeforeUnmount(qr.stop)
</script>

<style scoped>
.netdisk-login {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.netdisk-login-panel {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  max-width: 360px;
}
.netdisk-login-note {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.netdisk-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
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
