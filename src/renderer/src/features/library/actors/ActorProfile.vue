<template>
  <!-- 演员资料头：大头像、名字与别名、资料行、操作、简介 -->
  <header class="lib-actor-hero">
    <UiIconButton
      class="lib-actor-back"
      icon="back"
      variant="secondary"
      label="返回"
      @click="emit('close')"
    />
    <div class="lib-actor-hero-body">
      <span class="lib-actor-hero-photo">
        <img
          v-if="photo"
          :src="photo"
          alt=""
          decoding="async"
          referrerpolicy="no-referrer"
        />
        <span v-else>{{ initialOf(actor.name) }}</span>
      </span>
      <div class="lib-actor-hero-text">
        <h1 class="lib-actor-hero-name">{{ actor.name }}</h1>
        <p v-if="actor.aliases.length" class="lib-actor-hero-aliases">
          {{ actor.aliases.join(' / ') }}
        </p>
        <dl v-if="facts.length" class="lib-actor-facts">
          <div v-for="fact in facts" :key="fact.label" class="lib-actor-fact">
            <dt>{{ fact.label }}</dt>
            <dd>{{ fact.value }}</dd>
          </div>
        </dl>
        <p v-else-if="stateText" class="lib-actor-hero-state">
          {{ stateText }}
        </p>
        <div class="lib-actor-hero-actions">
          <UiButton
            icon="edit"
            variant="secondary"
            size="lg"
            label="编辑资料"
            @click="emit('edit')"
          />
          <UiButton
            icon="refresh"
            variant="secondary"
            size="lg"
            label="重新获取资料"
            :loading="refreshing"
            @click="emit('refresh')"
          />
          <span v-if="actor.lockedFields.length" class="lib-actor-hero-locks">
            <UiIcon name="lock" />
            已锁定 {{ actor.lockedFields.length }} 项
          </span>
        </div>
        <p
          v-if="actor.overview"
          class="lib-actor-hero-overview"
          :class="{ 'is-expanded': overviewOpen }"
          @click="overviewOpen = !overviewOpen"
        >
          {{ actor.overview }}
        </p>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * 演员详情的资料头：圆形大头像（没有时显示首字）、名字、别名、生日 / 身高 / 三围 / 罩杯 / 出身地，
 * 编辑与重新获取，可展开的简介。资料还没查到时给一句状态说明。
 */
import { computed, ref, watch } from 'vue'

import type { ActorDetail } from '../../../../../shared/library/ipc'
import UiIcon from '@/components/ui/UiIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'

import { itemImage } from '../api/images'
import { actorFacts, initialOf } from './actor-rules'

const props = defineProps<{ actor: ActorDetail; refreshing: boolean }>()
const emit = defineEmits<{ close: []; edit: []; refresh: [] }>()

const overviewOpen = ref(false)
watch(
  () => props.actor.id,
  () => (overviewOpen.value = false)
)

const photo = computed(() => itemImage(props.actor.photo, 480))
const facts = computed(() => actorFacts(props.actor, new Date()))

const STATE_TEXT: Record<ActorDetail['profileState'], string> = {
  pending: '正在后台查询资料…',
  missing: '资料来源里没有查到这位演员，可以手动编辑。',
  error: '资料来源暂时无法访问，稍后会自动重试。',
  found: '',
}
const stateText = computed(() => STATE_TEXT[props.actor.profileState])
</script>

<style scoped>
.lib-actor-hero {
  position: relative;
  padding: var(--space-6) var(--content-padding-x) var(--space-8);
}
.lib-actor-back {
  margin-bottom: var(--space-6);
}
.lib-actor-hero-body {
  display: flex;
  align-items: flex-start;
  gap: var(--space-8);
}
.lib-actor-hero-photo {
  display: grid;
  flex: 0 0 168px;
  width: 168px;
  height: 168px;
  overflow: hidden;
  place-items: center;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
  color: var(--text-tertiary);
  font-size: var(--text-3xl);
  box-shadow: var(--shadow-md);
}
.lib-actor-hero-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 20%;
}
.lib-actor-hero-text {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 680px;
  padding-top: var(--space-2);
}
.lib-actor-hero-name {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
}
.lib-actor-hero-aliases {
  margin: var(--space-2) 0 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
.lib-actor-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3) var(--space-7);
  margin: var(--space-5) 0 0;
}
.lib-actor-fact dt {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.lib-actor-fact dd {
  margin: var(--space-0_5) 0 0;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.lib-actor-hero-state {
  margin: var(--space-5) 0 0;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
.lib-actor-hero-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
.lib-actor-hero-locks {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: var(--space-2);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.lib-actor-hero-overview {
  display: -webkit-box;
  margin: var(--space-5) 0 0;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  white-space: pre-line;
  cursor: pointer;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
}
.lib-actor-hero-overview.is-expanded {
  display: block;
}
</style>
