<template>
  <header class="dialog-titlebar">
    <div class="dialog-titlebar-caption">
      <AppIcon v-if="icon" :name="icon" size="sm" />
      <span class="dialog-titlebar-title"><slot>{{ title }}</slot></span>
    </div>
    <div v-if="$slots.actions" class="dialog-titlebar-actions"><slot name="actions" /></div>
    <button v-if="closable" class="dialog-titlebar-close" type="button" :aria-label="closeLabel" :title="closeLabel" @click="$emit('close', $event)"><AppIcon name="close" size="sm" /></button>
  </header>
</template>

<script setup lang="ts">
import AppIcon from './AppIcon.vue'
withDefaults(defineProps<{
  title?: string
  icon?: InstanceType<typeof AppIcon>['$props']['name']
  closable?: boolean
  closeLabel?: string
}>(), { closable: true, closeLabel: '关闭' })
defineEmits<{ close: [event: MouseEvent] }>()
</script>

<style scoped>
.dialog-titlebar { display:flex; align-items:center; flex:0 0 40px; min-width:0; height:40px; min-height:40px; padding:0; margin:0; border-bottom:1px solid var(--border-subtle); background:var(--bg-elevated); color:var(--text-primary); user-select:none; -webkit-app-region:no-drag; }
.dialog-titlebar-caption { display:flex; align-items:center; gap:8px; min-width:0; flex:1; padding:0 16px; }
.dialog-titlebar-caption > .app-icon { flex-shrink:0; color:var(--text-secondary); }
.dialog-titlebar-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:500 13px/1.4 var(--font-sans); }
.dialog-titlebar-actions { display:flex; align-items:center; gap:4px; padding-right:8px; }
.dialog-titlebar .dialog-titlebar-close { display:grid; place-items:center; flex:0 0 46px; width:46px; height:40px; min-height:40px; padding:0; border:0; border-radius:0; box-shadow:none; background:transparent; color:var(--text-secondary); cursor:pointer; transition:background 120ms ease,color 120ms ease; }
.dialog-titlebar .dialog-titlebar-close:hover { background:#c42b1c; color:#fff; }
.dialog-titlebar .dialog-titlebar-close:active { background:#a92518; color:#fff; }
.dialog-titlebar .dialog-titlebar-close:focus-visible { outline:2px solid var(--accent-text); outline-offset:-4px; }
@media(prefers-reduced-motion:reduce) { .dialog-titlebar .dialog-titlebar-close { transition:none; } }
</style>
