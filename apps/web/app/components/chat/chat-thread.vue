<script setup lang="ts">
import type { ChatMessage } from '~/composables/use-chat'
import { useI18n } from 'vue-i18n'
import PencilIcon from '~icons/heroicons/pencil-square'
import MarkdownRenderer from '~/components/notes/markdown-renderer.vue'

const props = defineProps<{
  messages: ChatMessage[]
}>()

const emit = defineEmits<{
  (e: 'edit', message: ChatMessage): void
}>()

const { t } = useI18n()

function noteHref(path: string): string {
  return `/notes?note=${encodeURIComponent(path)}`
}
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
    <div
      v-for="message in props.messages"
      :key="message.id"
      class="flex"
      :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
    >
      <div
        class="group relative max-w-3xl rounded-lg px-4 py-3"
        :class="[
          message.role === 'user'
            ? 'bg-indigo-600 text-white'
            : message.isError
              ? 'bg-red-50 text-red-900 border border-red-200'
              : 'bg-white border border-gray-200 text-gray-900',
        ]"
      >
        <button
          v-if="message.role === 'user' && message.persisted"
          type="button"
          class="absolute -left-8 top-2 p-1 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:text-indigo-600 transition-opacity"
          :title="t('chat.editMessage')"
          @click="emit('edit', message)"
        >
          <PencilIcon class="h-4 w-4" />
        </button>

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
