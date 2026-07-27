<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ArchiveBoxIcon from '~icons/heroicons/archive-box'
import ArchiveBoxXMarkIcon from '~icons/heroicons/archive-box-x-mark'
import ChevronDownIcon from '~icons/heroicons/chevron-down'
import ChevronRightIcon from '~icons/heroicons/chevron-right'
import PlusIcon from '~icons/heroicons/plus'

export interface ChatConversationSummary {
  id: string
  title: string
  updatedAt: string
}

const props = withDefaults(defineProps<{
  conversations: ChatConversationSummary[]
  archivedConversations?: ChatConversationSummary[]
  selectedId: string | null
}>(), {
  archivedConversations: () => [],
})

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'newConversation'): void
  (e: 'archive', id: string): void
  (e: 'unarchive', id: string): void
}>()

const { t } = useI18n()
const archivedOpen = ref(false)
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
          class="group relative px-4 py-3 cursor-pointer hover:bg-gray-50"
          :class="selectedId === conversation.id ? 'bg-indigo-50' : ''"
          @click="emit('select', conversation.id)"
        >
          <p class="text-sm font-medium text-gray-900 truncate pr-7">
            {{ conversation.title || t('chat.untitled') }}
          </p>
          <p class="text-xs text-gray-500 mt-1">
            {{ new Date(conversation.updatedAt).toLocaleString() }}
          </p>
          <button
            type="button"
            class="absolute right-3 top-3 p-1 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:text-indigo-600 transition-opacity"
            :title="t('chat.archive')"
            @click.stop="emit('archive', conversation.id)"
          >
            <ArchiveBoxIcon class="h-4 w-4" />
          </button>
        </li>
      </ul>

      <div v-if="props.archivedConversations.length > 0" class="border-t border-gray-200">
        <button
          type="button"
          class="w-full flex items-center gap-2 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-700"
          @click="archivedOpen = !archivedOpen"
        >
          <component :is="archivedOpen ? ChevronDownIcon : ChevronRightIcon" class="h-3.5 w-3.5" />
          {{ t('chat.archived') }} ({{ props.archivedConversations.length }})
        </button>
        <ul v-if="archivedOpen" class="divide-y divide-gray-100">
          <li
            v-for="conversation in props.archivedConversations"
            :key="conversation.id"
            class="group relative px-4 py-2 hover:bg-gray-50"
          >
            <p class="text-sm text-gray-500 truncate pr-7">
              {{ conversation.title || t('chat.untitled') }}
            </p>
            <button
              type="button"
              class="absolute right-3 top-2 p-1 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:text-indigo-600 transition-opacity"
              :title="t('chat.unarchive')"
              @click.stop="emit('unarchive', conversation.id)"
            >
              <ArchiveBoxXMarkIcon class="h-4 w-4" />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
