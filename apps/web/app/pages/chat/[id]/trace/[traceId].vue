<script setup lang="ts">
import type { TraceResponse } from '~/components/chat/chat-trace-view.vue'
import { useI18n } from 'vue-i18n'
import ArrowLeftIcon from '~icons/heroicons/arrow-left'
import ChatTraceView from '~/components/chat/chat-trace-view.vue'

definePageMeta({
  middleware: ['auth', 'onboarding'],
  layout: 'default',
})

const route = useRoute()
const { t } = useI18n()

const conversationId = computed(() => route.params.id as string)
const traceId = computed(() => route.params.traceId as string)

const { data: trace, pending, error } = await useFetch<TraceResponse>(
  () => `/api/traces/${traceId.value}`,
  {
    key: computed(() => `trace-${traceId.value}`),
    watch: [traceId],
  },
)

function backHref() {
  return `/chat?conversationId=${conversationId.value}`
}
</script>

<template>
  <div class="flex h-[calc(100dvh-3.5rem)] flex-col bg-gray-50">
    <div class="border-b border-gray-200 bg-white px-6 py-4">
      <NuxtLink
        :to="backHref()"
        class="mb-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
      >
        <ArrowLeftIcon class="h-3.5 w-3.5" />
        {{ t('chat.trace.back') }}
      </NuxtLink>

      <div v-if="pending" class="text-sm text-gray-500">
        {{ t('chat.trace.loading') }}
      </div>

      <div v-else-if="error || !trace" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
        {{ t('chat.trace.error') }}
      </div>

      <ChatTraceView v-else :trace="trace" />
    </div>
  </div>
</template>
