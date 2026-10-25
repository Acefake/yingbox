<template>
  <!-- 演职员：横向滑动 -->
  <section class="lib-section">
    <h2 class="lib-section-title">演职员</h2>
    <ul class="lib-row lib-cast">
      <li v-for="person in people" :key="person.key" class="lib-person">
        <component
          :is="person.actorId ? UiPressable : 'div'"
          class="lib-person-target"
          :class="{ 'is-link': person.actorId }"
          @click="person.actorId && emit('open-actor', person.actorId)"
        >
          <div class="lib-person-photo">
            <img
              v-if="person.photo"
              :src="person.photo"
              alt=""
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
            />
            <span v-else>{{ person.name.slice(0, 1) }}</span>
          </div>
          <div class="lib-person-name">{{ person.name }}</div>
          <div class="lib-person-role">{{ person.role }}</div>
        </component>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
/**
 * 详情里的演职员区块（效果图 D-3）：132px 圆形头像（没有时显示名字首字）、姓名、职务 / 角色，横向滑动。
 * 番号库条目的演员在演员库里有记录时可点，打开演员详情。
 */
import UiPressable from '@/components/ui/UiPressable.vue'

import type { PersonCard } from './detail-rules'

defineProps<{ people: PersonCard[] }>()
const emit = defineEmits<{ 'open-actor': [actorId: number] }>()
</script>

<style scoped src="./detail-section.css"></style>
<style scoped>
.lib-cast {
  gap: var(--space-6_5);
}
.lib-person {
  width: 132px;
  text-align: center;
}
.lib-person-target {
  display: block;
  width: 100%;
}
.lib-person-target.is-link {
  cursor: pointer;
}
.lib-person-target.is-link:hover .lib-person-photo {
  transform: scale(1.04);
}
.lib-person-target.is-link:hover .lib-person-name {
  color: var(--accent);
}
.lib-person-photo {
  position: relative;
  display: grid;
  width: 132px;
  height: 132px;
  margin-bottom: var(--space-3);
  overflow: hidden;
  place-items: center;
  border-radius: 50%;
  background: var(--bg-fill-secondary);
  color: var(--text-tertiary);
  font-size: var(--text-2xl);
  transition: transform var(--duration-normal) var(--ease-out);
}
/* 0.5px 发丝边 */
.lib-person-photo::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 0.5px var(--border-glass-light);
  content: '';
}
.lib-person-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 18%;
}
.lib-person-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-md);
  font-weight: var(--font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-person-role {
  margin-top: var(--space-0_5);
  overflow: hidden;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 720px) {
  .lib-person,
  .lib-person-photo {
    width: 104px;
  }
  .lib-person-photo {
    height: 104px;
  }
}
</style>
