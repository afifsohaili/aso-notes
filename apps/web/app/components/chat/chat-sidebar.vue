<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import PlusIcon from '~icons/heroicons/plus'

export interface ChatConversationSummary {
  id: string
  title: string
  updatedAt: string
}

const props = defineProps<{
  conversations: ChatConversationSummary[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'newConversation'): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="h-full flex flex-col bg-white border-r border-gray-200">
    <div class="p-4 border-b border-gray-200">
      <button
        class="w-full inline-flex items-center justify-center px-3 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        @click="emit('newConversation')"
      >
        <PlusIcon class="h-4 w-4 mr-1.5" />
        {{ t('chat.newConversation') }}
      </button>
    </div>
    <div class="flex-1 overflow-y-auto">
      <ul class="divide-y divide-gray-200">
        <li
          v-for="conversation in props.conversations"
          :key="conversation.id"
          class="px-4 py-3 cursor-pointer hover:bg-gray-50"
          :class="selectedId === conversation.id ? 'bg-indigo-50' : ''"
          @click="emit('select', conversation.id)"
        >
          <p class="text-sm font-medium text-gray-900 truncate">
            {{ conversation.title || t('chat.untitled') }}
          </p>
          <p class="text-xs text-gray-500 mt-1">
            {{ new Date(conversation.updatedAt).toLocaleString() }}
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>
