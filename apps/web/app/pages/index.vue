<script setup lang="ts">
const { session } = await useSession()
await navigateTo(session.value ? '/chat' : '/login', { replace: true })
</script>

<template>
  <div />
</template>
