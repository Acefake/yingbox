<template>
  <section class="yb-settings-group settings-list-section">
    <button
      class="settings-section-toggle"
      type="button"
      @click="open = !open"
    >
      <span class="settings-section-icon" aria-hidden="true">
        <svg
          v-if="icon === 'image'"
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <svg
          v-else-if="icon === 'play'"
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <svg
          v-else-if="icon === 'globe'"
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 004 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <svg
          v-else-if="icon === 'database'"
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3M4 7v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 7c0 1.657 3.582 3 8 3s8-1.343 8-3m0 10v-5"
          />
        </svg>
        <svg
          v-else-if="icon === 'download'"
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.75"
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
      </span>
      <span class="settings-section-title">{{ title }}</span>
      <svg
        class="settings-chevron"
        :class="{ 'is-open': open }"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.75"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </button>

    <Transition name="section">
      <div v-if="open" class="settings-section-body">
        <slot />
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ title: string; icon?: string }>()
const open = ref(true)
</script>

<style scoped>
.settings-list-section {
  margin-bottom: var(--space-3);
}

.settings-section-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 0 10px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  color: var(--text-primary);
  transition: var(--transition-fast);
}

.settings-section-toggle:hover { color: var(--accent-text); }
.settings-section-toggle:active { transform: scale(0.99); }

.settings-section-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--bg-fill-secondary);
  color: var(--text-secondary);
}

.settings-section-title {
  flex: 1;
  min-width: 0;
  font-size: var(--text-md);
  font-weight: var(--font-weight-semibold);
  letter-spacing: -0.015em;
  color: inherit;
}

.settings-chevron {
  width: 14px;
  height: 14px;
  color: var(--text-tertiary);
  transition: transform 0.3s var(--ease-out);
}

.settings-chevron.is-open {
  transform: rotate(180deg);
}

.settings-section-body {
  padding-top: 2px;
}

.section-enter-active,
.section-leave-active {
  transition: opacity 0.28s var(--ease-out), transform 0.28s var(--ease-out);
}

.section-enter-from,
.section-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .settings-section-toggle:active { transform: none; }
  .settings-chevron { transition: none; }
  .section-enter-active,
  .section-leave-active {
    transition: opacity 0.2s ease;
  }
  .section-enter-from,
  .section-leave-to { transform: none; }
}
</style>
