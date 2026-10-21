<template>
  <!-- 演职员：横向滑动 -->
  <section class="lib-section">
    <h2 class="lib-section-title">演职员</h2>
    <ul class="lib-cast custom-scrollbar">
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
 * 详情里的演职员区块：圆形头像（没有时显示名字首字）、姓名、职务 / 角色，横向滑动。
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
  display: flex;
  gap: var(--space-5);
  margin: 0 calc(var(--content-padding-x) * -1);
  padding: 0 var(--content-padding-x) var(--space-3);
  overflow-x: auto;
  list-style: none;
  scroll-padding-inline: var(--content-padding-x);
  scroll-snap-type: x proximity;
}
.lib-person {
  flex: 0 0 104px;
  text-align: center;
  scroll-snap-align: start;
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
  display: grid;
  transition: transform var(--duration-normal) var(--ease-out);
  width: 104px;
  height: 104px;
  margin-bottom: var(--space-3);
  overflow: hidden;
  place-items: center;
  border-radius: var(--radius-full);
  background: var(--bg-fill-secondary);
  color: var(--text-tertiary);
  font-size: var(--text-xl);
}
.lib-person-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lib-person-name {
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lib-person-role {
  margin-top: var(--space-0_5);
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
