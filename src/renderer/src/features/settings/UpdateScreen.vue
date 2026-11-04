<template>
  <Teleport to="body">
    <div v-if="update.installing.value" class="update-screen" role="status">
      <img
        class="update-screen-logo"
        :src="logoUrl"
        alt=""
        aria-hidden="true"
      />
      <h2 class="update-screen-title">正在安装更新</h2>
      <p class="update-screen-sub">马上回来，请不要关机</p>
      <div class="update-screen-bar" role="progressbar" aria-label="安装中">
        <div class="update-screen-fill" />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 点「更新并重启」后的全窗口画面：安装包在后台静默安装，装完会自己拉起新版。
 * 出错时 installing 复位，画面自动消失。
 */
import logoUrl from '@/assets/imgs/logo.svg'

import { useUpdateStatus } from './use-update-status'

const update = useUpdateStatus()
</script>

<style scoped>
.update-screen {
  position: fixed;
  inset: 0;
  z-index: var(--z-max);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  background: var(--bg-main);
  color: var(--text-primary);
}
.update-screen-logo {
  width: 64px;
  height: 64px;
  margin-bottom: var(--space-2);
  animation: update-breathe var(--duration-pulse) ease-in-out infinite;
}
.update-screen-title {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}
.update-screen-sub {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.update-screen-bar {
  width: 240px;
  height: 6px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: var(--bg-active);
}
.update-screen-fill {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--accent);
  animation: update-pulse var(--duration-pulse) ease-in-out infinite;
}
@keyframes update-breathe {
  50% {
    transform: scale(1.08);
  }
}
@keyframes update-pulse {
  50% {
    opacity: 0.4;
  }
}
@media (prefers-reduced-motion: reduce) {
  .update-screen-logo,
  .update-screen-fill {
    animation: none;
  }
}
</style>
