<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import MarkdownRenderer from '~/components/notes/markdown-renderer.vue'

export interface ChatThreadMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  notes?: string[]
  isError?: boolean
}

const props = defineProps<{
  messages: ChatThreadMessage[]
}>()

const { t } = useI18n()

function noteHref(path: string): string {
  return `/notes?note=${encodeURIComponent(path)}`
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6 space-y-6">
    <div
      v-for="message in props.messages"
      :key="message.id"
      class="flex"
      :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
    >
      <div
        class="max-w-3xl rounded-lg px-4 py-3"
        :class="[
          message.role === 'user'
            ? 'bg-indigo-600 text-white'
            : message.isError
              ? 'bg-red-50 text-red-900 border border-red-200'
              : 'bg-white border border-gray-200 text-gray-900',
        ]"
      >
        <div v-if="message.role === 'user'" class="whitespace-pre-wrap">
          {{ message.content }}
        </div>
        <div v-else>
          <MarkdownRenderer :content="message.content" />
        </div>

        <div v-if="message.notes && message.notes.length > 0" class="mt-4 pt-3 border-t" :class="message.role === 'user' ? 'border-indigo-500' : 'border-gray-200'">
          <p class="text-xs font-medium mb-2" :class="message.role === 'user' ? 'text-indigo-100' : 'text-gray-500'">
            {{ t('chat.sources') }}
          </p>
          <ul class="space-y-1">
            <li v-for="(note, index) in message.notes" :key="index">
              <nuxt-link
                :to="noteHref(note)"
                class="text-sm hover:underline"
                :class="message.role === 'user' ? 'text-indigo-100' : 'text-indigo-600 hover:text-indigo-900'"
              >
                {{ note }}
              </nuxt-link>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
