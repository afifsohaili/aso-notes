<script setup lang="ts">
import type { UsageSummary as UsageSummaryData } from '~/types/usage-summary'
import UsageSummary from '~/components/settings/usage/usage-summary.vue'

definePageMeta({
  layout: 'settings',
})

const { data: summary, pending, error } = await useFetch<UsageSummaryData>('/api/usage')
</script>

<template>
  <section>
    <UsageSummary :summary="summary ?? null" :pending="pending" :error="!!error" />
  </section>
</template>
