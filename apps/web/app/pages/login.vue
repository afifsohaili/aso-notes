<script setup>
const { session } = await useSession()

if (session.value) {
  await navigateTo('/chat', { replace: true })
}
</script>

<template>
  <pre-dev>{{ session || 'null' }}</pre-dev>
  <login-form />
</template>
