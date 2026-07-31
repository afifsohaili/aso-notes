<script setup>
const { session } = await useSession()

if (session.value) {
  await navigateTo('/chat', { replace: true })
}
</script>

<template>
  <login-form />
</template>
