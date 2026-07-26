<script lang="ts" setup>
import IconGraph from '~icons/mdi/graph-outline'
import { appInfo } from '~/composables/app'
</script>

<template>
  <span class="inline-flex items-center gap-2 select-none">
    <IconGraph class="text-indigo-600" />
    <strong class="font-semibold tracking-tight">{{ appInfo.name }}</strong>
  </span>
</template>
