<template>
  <SettingsGroup title="推送渠道" :footer="CHANNEL_FOOTER">
    <SettingsRow title="系统通知" description="在这台电脑的通知中心弹出">
      <UiButton
        v-if="system"
        size="sm"
        variant="plain"
        label="测试"
        :loading="testing === 'system'"
        @click="test('system')"
      />
      <UiSwitch v-model="system" label="系统通知" />
    </SettingsRow>

    <SettingsRow title="Bark" description="推到 iPhone（官方或自建服务器）">
      <UiSwitch v-model="barkEnabled" label="Bark" />
    </SettingsRow>
    <template v-if="barkEnabled">
      <SettingsRow title="服务器地址" stacked>
        <UiInput
          v-model="barkServerInput"
          aria-label="Bark 服务器地址"
          placeholder="https://api.day.app"
          :invalid="!barkServerOk"
          @change="saveBarkServer"
        />
      </SettingsRow>
      <SettingsRow title="设备 key" stacked>
        <template #description>Bark App 首页推送地址里的那一段</template>
        <UiInput
          v-model="barkKey"
          type="password"
          autocomplete="off"
          aria-label="Bark 设备 key"
          :placeholder="secretPlaceholder(bark.configured.value, '设备 key')"
        />
        <div class="notify-actions">
          <UiButton
            size="sm"
            label="测试"
            :disabled="!bark.configured.value"
            :loading="testing === 'bark'"
            @click="test('bark')"
          />
          <UiButton
            v-if="bark.configured.value && !barkKey"
            size="sm"
            variant="plain"
            label="清除"
            @click="bark.draft.clear()"
          />
        </div>
      </SettingsRow>
    </template>

    <SettingsRow title="Telegram" description="经你自己的 Bot 发消息">
      <UiSwitch v-model="telegramEnabled" label="Telegram" />
    </SettingsRow>
    <template v-if="telegramEnabled">
      <SettingsRow title="Bot token" stacked>
        <template #description>找 @BotFather 创建 Bot 后拿到</template>
        <UiInput
          v-model="telegramToken"
          type="password"
          autocomplete="off"
          aria-label="Telegram Bot token"
          :placeholder="
            secretPlaceholder(telegram.configured.value, '123456:ABC…')
          "
        />
      </SettingsRow>
      <SettingsRow title="Chat ID" stacked>
        <template #description>
          先给 Bot 发一句话，再用 getUpdates 查到的 chat.id
        </template>
        <UiInput
          v-model="chatIdInput"
          aria-label="Telegram Chat ID"
          placeholder="例如 123456789"
          @change="saveChatId"
        />
        <div class="notify-actions">
          <UiButton
            size="sm"
            label="测试"
            :disabled="!telegram.configured.value || !chatId"
            :loading="testing === 'telegram'"
            @click="test('telegram')"
          />
          <UiButton
            v-if="telegram.configured.value && !telegramToken"
            size="sm"
            variant="plain"
            label="清除 token"
            @click="telegram.draft.clear()"
          />
        </div>
      </SettingsRow>
    </template>
  </SettingsGroup>

  <SettingsGroup title="推送什么">
    <SettingsRow
      title="追更的集入库"
      description="追更转存到 115 的新集进了片库"
    >
      <UiSwitch v-model="onAutograb" label="追更的集入库" />
    </SettingsRow>
    <SettingsRow title="新剧集" description="片库里出现新的一集">
      <UiSwitch v-model="onEpisode" label="新剧集" />
    </SettingsRow>
    <SettingsRow title="新电影" description="片库里出现新的电影">
      <UiSwitch v-model="onMovie" label="新电影" />
    </SettingsRow>
    <SettingsRow title="合并推送" description="1 分钟内的多条合成一条">
      <UiSwitch v-model="merge" label="合并推送" />
    </SettingsRow>
  </SettingsGroup>

  <SettingsGroup title="自动中文字幕" :footer="SUBTITLE_FOOTER">
    <SettingsRow
      title="新入库时自动下载"
      description="没有中文字幕的电影 / 集，从 OpenSubtitles 下一份放到视频旁边"
    >
      <UiSwitch v-model="subtitlesEnabled" label="新入库时自动下载中文字幕" />
    </SettingsRow>
    <SettingsRow v-if="subtitlesEnabled" title="每天最多">
      <UiSelect
        v-model="dailyLimit"
        :options="dailyLimitOptions(dailyLimit)"
        aria-label="每天最多下载几份字幕"
        class="settings-field is-inline"
      />
    </SettingsRow>
  </SettingsGroup>
</template>

<script setup lang="ts">
/**
 * 设置 · 新入库：推送渠道（系统通知 / Bark / Telegram）、推送哪几类、合并，以及新入库自动下载中文字幕。
 * 开关与地址是普通设置 notify.* / subtitles.auto.*；Bark key、Telegram token 是密钥（只写不读）。
 * 推送在主进程（src/main/notify），自动字幕在媒体库引擎（src/main/library/subtitles）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { toast } from '@/components/ui'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import {
  SettingsGroup,
  SettingsRow,
  setSetting,
  useSetting,
} from '@/features/settings'

import type { NotifyChannelId } from '../../../../shared/contract/notifications'
import {
  dailyLimitOptions,
  secretPlaceholder,
  validBarkServer,
} from './notify-ui-rules'
import { secretField } from './secret-field'

const CHANNEL_FOOTER =
  'Bark key 和 Telegram token 加密保存在本机，只用于发推送，不写进日志。'
const SUBTITLE_FOOTER =
  '要先在媒体库设置里填 OpenSubtitles API key。只处理打开之后新入库的条目；字幕存成「视频名.zh.srt」（繁体 .zh-TW.srt）。WebDAV 上的、文件夹不可写的网盘条目会跳过。'

const system = useSetting('notify.system')
const barkEnabled = useSetting('notify.bark.enabled')
const telegramEnabled = useSetting('notify.telegram.enabled')
const onAutograb = useSetting('notify.on.autograb')
const onEpisode = useSetting('notify.on.episode')
const onMovie = useSetting('notify.on.movie')
const merge = useSetting('notify.merge')
const subtitlesEnabled = useSetting('subtitles.auto.enabled')
const dailyLimit = useSetting('subtitles.auto.dailyLimit')

const barkServer = useSetting('notify.bark.server')
const barkServerInput = ref(barkServer.value)
watch(barkServer, value => (barkServerInput.value = value))
const barkServerOk = computed(() => validBarkServer(barkServerInput.value))

const chatId = useSetting('notify.telegram.chatId')
const chatIdInput = ref(chatId.value)
watch(chatId, value => (chatIdInput.value = value))

const bark = secretField('notify.bark.key')
const telegram = secretField('notify.telegram.token')
const barkKey = computed({
  get: () => bark.draft.value.value,
  set: bark.draft.input,
})
const telegramToken = computed({
  get: () => telegram.draft.value.value,
  set: telegram.draft.input,
})
onBeforeUnmount(() => {
  bark.draft.flush()
  telegram.draft.flush()
})

async function saveBarkServer(): Promise<void> {
  if (!barkServerOk.value) return
  await setSetting('notify.bark.server', barkServerInput.value.trim())
}

async function saveChatId(): Promise<void> {
  try {
    await setSetting('notify.telegram.chatId', chatIdInput.value.trim())
  } catch {
    toast.error('Chat ID 太长了')
    chatIdInput.value = chatId.value
  }
}

const testing = ref<NotifyChannelId | null>(null)

async function test(channel: NotifyChannelId): Promise<void> {
  // 还在输入框里、没到保存时间的密钥先存
  bark.draft.flush()
  telegram.draft.flush()
  testing.value = channel
  try {
    await Promise.all([bark.settled(), telegram.settled()])
    const result = await window.api!.notifications.test(channel)
    if (result.ok) toast.success('已发出测试推送')
    else toast.error(result.error ?? '发送失败')
  } catch (error) {
    toast.error((error as Error).message)
  } finally {
    testing.value = null
  }
}
</script>

<style scoped>
.notify-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
</style>
