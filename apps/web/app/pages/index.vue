<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t: _ } = useI18n()
const { session } = await useSession()

if (session.value) {
  await navigateTo('/chat', { replace: true })
}

definePageMeta({
  layout: 'default-no-logo',
})
</script>

<template>
  <landing-page />
</template>
