<script setup lang="ts">
import type { IngestionStatusResponse } from '~~/server/lib/sync/ingestion-status'
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import QueueListIcon from '~icons/heroicons/queue-list'

interface CountCard {
  label: string
  value: number
}

definePageMeta({
  middleware: ['auth', 'onboarding'],
  layout: 'default',
})

const { t } = useI18n()

const { data: status, refresh } = await useFetch<IngestionStatusResponse>('/api/ingestion/status')

const pollInterval = ref<ReturnType<typeof setInterval> | null>(null)

onMounted(() => {
  pollInterval.value = setInterval(refresh, 3000)
})

onUnmounted(() => {
  if (pollInterval.value) {
    clearInterval(pollInterval.value)
    pollInterval.value = null
  }
})

const dbCards = computed<CountCard[]>(() => [
  { label: t('queue.db.pending'), value: status.value?.db.pending ?? 0 },
  { label: t('queue.db.queued'), value: status.value?.db.queued ?? 0 },
  { label: t('queue.db.processing'), value: status.value?.db.processing ?? 0 },
  { label: t('queue.db.ingested'), value: status.value?.db.ingested ?? 0 },
  { label: t('queue.db.failed'), value: status.value?.db.failed ?? 0 },
])

const queueCards = computed<CountCard[]>(() => {
  const queue = status.value?.queue
  if (!queue)
    return []
  return [
    { label: t('queue.queue.waiting'), value: queue.waiting },
    { label: t('queue.queue.active'), value: queue.active },
    { label: t('queue.queue.completed'), value: queue.completed },
    { label: t('queue.queue.failed'), value: queue.failed },
    { label: t('queue.queue.delayed'), value: queue.delayed },
  ]
})

const activeJobs = computed(() => status.value?.activeJobs ?? [])

function noteLink(path: string): string {
  return `/notes${path}`
}

function formatRelative(iso: string | null): string {
  if (!iso)
    return t('queue.sweeper.never')
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60)
    return t('queue.sweeper.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return t('queue.sweeper.minutesAgo', { minutes })
  const hours = Math.floor(minutes / 60)
  return t('queue.sweeper.hoursAgo', { hours })
}
</script>

<template>
  <div class="container max-w-4xl px-6 py-10 mx-auto">
    <h1 class="text-2xl font-bold text-gray-900 flex items-center gap-2">
      <QueueListIcon class="h-6 w-6" />
      {{ t('queue.title') }}
    </h1>

    <section class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">
        {{ t('queue.db.title') }}
      </h2>
      <div class="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
        <div
          v-for="card in dbCards"
          :key="card.label"
          class="rounded-lg border border-gray-200 bg-white p-4"
        >
          <p class="text-sm font-medium text-gray-500">
            {{ card.label }}
          </p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">
            {{ card.value }}
          </p>
        </div>
      </div>
    </section>

    <section class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">
        {{ t('queue.queue.title') }}
      </h2>
      <div
        v-if="status?.queue === null"
        class="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600"
      >
        {{ t('queue.queue.unavailable') }}
      </div>
      <div
        v-else
        class="mt-2 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4"
      >
        <div
          v-for="card in queueCards"
          :key="card.label"
          class="rounded-lg border border-gray-200 bg-white p-4"
        >
          <p class="text-sm font-medium text-gray-500">
            {{ card.label }}
          </p>
          <p class="mt-1 text-2xl font-semibold text-gray-900">
            {{ card.value }}
          </p>
        </div>
      </div>
    </section>

    <section class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">
        {{ t('queue.activeJobs.title') }}
      </h2>
      <ul
        v-if="activeJobs.length > 0"
        class="mt-2 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white"
      >
        <li
          v-for="job in activeJobs"
          :key="job.id"
          class="flex items-center justify-between px-4 py-3"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900 truncate">
              {{ job.title ?? job.path }}
            </p>
            <p class="text-xs text-gray-500 truncate">
              {{ job.path }}
            </p>
          </div>
          <NuxtLink
            :to="noteLink(job.path)"
            class="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            {{ t('queue.activeJobs.open') }}
          </NuxtLink>
        </li>
      </ul>
      <p v-else class="mt-2 text-sm text-gray-500">
        {{ t('queue.activeJobs.empty') }}
      </p>
    </section>

    <section class="mt-8">
      <h2 class="text-lg font-semibold text-gray-900">
        {{ t('queue.sweeper.title') }}
      </h2>
      <div class="mt-2 rounded-lg border border-gray-200 bg-white p-4">
        <p class="text-sm text-gray-600">
          {{ t('queue.sweeper.lastSweep') }}:
          <span class="font-medium text-gray-900">
            {{ formatRelative(status?.sweeper.lastSweepAt ?? null) }}
          </span>
        </p>
        <p class="mt-1 text-sm text-gray-600">
          {{ t('queue.sweeper.dispatched') }}:
          <span class="font-medium text-gray-900">{{ status?.sweeper.lastDispatched ?? 0 }}</span>
          · {{ t('queue.sweeper.failed') }}:
          <span class="font-medium text-gray-900">{{ status?.sweeper.lastFailed ?? 0 }}</span>
        </p>
      </div>
    </section>
  </div>
</template>
