<script setup lang="ts">
import { useI18n } from 'vue-i18n'

definePageMeta({
  layout: 'settings',
})

const { t } = useI18n()
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold text-gray-900">
      {{ t('settings.consolidation.title') }}
    </h2>
    <p class="mt-1 text-sm text-gray-600">
      {{ t('settings.consolidation.description') }}
    </p>
  </section>
</template>
