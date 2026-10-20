<template>
  <div class="agent-markdown">
    <template v-for="(block, index) in blocks" :key="index">
      <pre v-if="block.code"><code>{{ block.text }}</code></pre>
      <template v-else
        ><p
          v-for="(line, at) in block.text.split('\n')"
          :key="at"
          :class="{ 'agent-heading': /^#{1,6} /.test(line) }"
        >
          <template
            v-for="(token, part) in inline(line.replace(/^#{1,6} /, ''))"
            :key="part"
            ><strong v-if="token.kind === 'strong'">{{ token.text }}</strong
            ><code v-else-if="token.kind === 'code'">{{ token.text }}</code
            ><a
              v-else-if="token.kind === 'link'"
              :href="token.href"
              target="_blank"
              rel="noopener noreferrer"
              >{{ token.text }}</a
            ><span v-else>{{ token.text }}</span></template
          >
        </p></template
      >
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ text: string }>()
const blocks = computed(() =>
  props.text
    .split(/```[^\n]*\n|```/g)
    .map((text, index) => ({ text, code: index % 2 === 1 }))
)
interface Token {
  kind: 'text' | 'strong' | 'code' | 'link'
  text: string
  href?: string
}

function inline(text: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const match of text.matchAll(
    /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  )) {
    const at = match.index ?? 0
    if (at > last) tokens.push({ kind: 'text', text: text.slice(last, at) })
    if (match[1]) tokens.push({ kind: 'strong', text: match[1] })
    else if (match[2]) tokens.push({ kind: 'code', text: match[2] })
    else tokens.push({ kind: 'link', text: match[3], href: match[4] })
    last = at + match[0].length
  }
  if (last < text.length) tokens.push({ kind: 'text', text: text.slice(last) })
  return tokens
}
</script>
