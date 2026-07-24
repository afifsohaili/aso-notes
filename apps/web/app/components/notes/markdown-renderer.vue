<script setup lang="ts">
import { parse } from 'marked'

const props = defineProps<{
  content: string
}>()

const html = computed(() => {
  return parse(props.content || '')
})
</script>

<template>
  <div class="prose prose-sm max-w-none" v-html="html" />
</template>
