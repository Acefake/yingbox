<template>
  <!-- 演员卡是可点的内容卡片（头像 + 名字），不是操作按钮 -->
  <UiVirtualGrid
    v-if="actors.length"
    :items="actors"
    class="amane-actors"
    :item-key="actor => actor.id"
  >
    <template #default="{ item: actor }">
      <UiPressable class="amane-actor-card" @click="emit('select', actor)">
        <img
          v-if="actor.image_urls?.[0]"
          :src="amaneImage(actor.image_urls[0])"
          loading="lazy"
          alt=""
        />
        <span v-else class="amane-actor-placeholder">{{
          actor.name.slice(0, 1)
        }}</span>
        <strong>{{ actor.name }}</strong>
        <small>{{ actor.count }} 部作品</small>
      </UiPressable>
    </template>
  </UiVirtualGrid>
  <div v-else class="amane-empty">
    <h2>暂无演员资料</h2>
    <p>完成影片刮削后，演员会出现在这里。</p>
  </div>
</template>

<script setup lang="ts">
/** 演员墙：点演员按其作品筛选影片。 */
import { UiPressable, UiVirtualGrid } from '@/components/ui'
import { type AmaneActor, amaneImage } from '../../api/amane'

defineProps<{ actors: AmaneActor[] }>()
const emit = defineEmits<{ select: [actor: AmaneActor] }>()
</script>
