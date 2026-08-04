<script setup lang="ts">
import type { ChatConversationSummary } from '~/components/chat/chat-sidebar.vue'
import type { ChatMessage } from '~/composables/use-chat'
import { useEventListener } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import Bars3Icon from '~icons/heroicons/bars-3'
import ChatBubbleLeftRightIcon from '~icons/heroicons/chat-bubble-left-right'
import DocumentTextIcon from '~icons/heroicons/document-text'
import LightBulbIcon from '~icons/heroicons/light-bulb'
import PaperAirplaneIcon from '~icons/heroicons/paper-airplane'
import SparklesIcon from '~icons/heroicons/sparkles'
import XMarkIcon from '~icons/heroicons/x-mark'
import { useChat } from '~/composables/use-chat'

const { t } = useI18n()

interface ConversationDetailMessage {
  id: string
  role: string
  content: string | null
  tool_calls: unknown
  tool_call_id: string | null
  created_at: string
}

interface ConversationDetail extends ChatConversationSummary {
  created_at: string
  updated_at: string
  messages: ConversationDetailMessage[]
}

definePageMeta({
  middleware: ['auth', 'onboarding'],
  layout: 'default',
})

const route = useRoute()
const router = useRouter()

const conversationId = ref<string | null>(
  typeof route.query.conversationId === 'string' ? route.query.conversationId : null,
)

const { data: conversations, refresh: refreshConversations } = await useFetch<ChatConversationSummary[]>('/api/conversations')
const { data: archivedConversations, refresh: refreshArchived } = await useFetch<ChatConversationSummary[]>('/api/conversations?archived=true')
const { data: noteStatusCounts } = await useFetch<{ ingested: number }>('/api/notes/status-counts')

const sidebarConversations = computed(() => {
  return (conversations.value ?? []).map(c => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updated_at,
  }))
})

const sidebarArchived = computed(() => {
  return (archivedConversations.value ?? []).map(c => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updated_at,
  }))
})

const { data: conversation, refresh: refreshConversation } = useFetch<ConversationDetail>(
  () => conversationId.value ? `/api/conversations/${conversationId.value}` : null,
  {
    key: computed(() => `conversation-${conversationId.value ?? 'none'}`),
    watch: [conversationId],
  },
)

const {
  messages,
  activities,
  isStreaming,
  error,
  currentConversationId,
  sendQuery,
  cancel,
  reset,
  loadMessages,
} = useChat()

const skipNextDetailLoad = ref(false)

watch(conversation, (detail) => {
  if (!detail)
    return
  if (skipNextDetailLoad.value) {
    skipNextDetailLoad.value = false
    return
  }
  loadMessages(detail.messages)
}, { immediate: true })

let disposed = false
onBeforeUnmount(() => {
  disposed = true
  cancel()
})

watch(currentConversationId, (id) => {
  if (disposed || !id || id === conversationId.value)
    return
  skipNextDetailLoad.value = true
  conversationId.value = id
  router.replace({ query: { conversationId: id } })
  refreshConversations()
})

watch(
  () => route.query.conversationId,
  (value) => {
    conversationId.value = typeof value === 'string' ? value : null
  },
)

const queryText = ref('')
const queryInput = ref<HTMLTextAreaElement | null>(null)
const editingMessage = ref<ChatMessage | null>(null)
const sidebarOpen = ref(false)

useEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape')
    sidebarOpen.value = false
})

async function handleSubmit() {
  const text = queryText.value.trim()
  if (!text || isStreaming.value)
    return

  const editFromMessageId = editingMessage.value?.persisted ? editingMessage.value.id : undefined
  editingMessage.value = null
  queryText.value = ''
  error.value = null

  await sendQuery(text, { conversationId: conversationId.value ?? undefined, editFromMessageId })

  // Canonical reload: real message ids + persisted tool activity, citations
  // preserved by content match inside loadMessages
  if (!disposed && currentConversationId.value) {
    skipNextDetailLoad.value = false
    await refreshConversation()
    refreshConversations()
  }
}

const hasNotes = computed(() => (noteStatusCounts.value?.ingested ?? 0) > 0)

const suggestedQueries = computed(() => {
  const suggestions = []
  if (hasNotes.value)
    suggestions.push({ icon: DocumentTextIcon, text: t('chat.firstQuery.suggestions.withNotes') })
  else
    suggestions.push({ icon: ChatBubbleLeftRightIcon, text: t('chat.firstQuery.suggestions.noNotes') })
  suggestions.push({ icon: LightBulbIcon, text: t('chat.firstQuery.suggestions.general') })
  return suggestions
})

function sendSuggestedQuery(text: string) {
  queryText.value = text
  handleSubmit()
}

function startEdit(message: ChatMessage) {
  editingMessage.value = message
  queryText.value = message.content
  queryInput.value?.focus()
}

function cancelEdit() {
  editingMessage.value = null
  queryText.value = ''
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    handleSubmit()
  }
  if (event.key === 'Escape' && editingMessage.value)
    cancelEdit()
}

function selectConversation(id: string) {
  sidebarOpen.value = false
  reset()
  cancelEdit()
  conversationId.value = id
}

function startNewConversation() {
  sidebarOpen.value = false
  reset()
  cancelEdit()
  conversationId.value = null
  router.replace({ query: {} })
  queryInput.value?.focus()
}

async function setArchived(id: string, archived: boolean) {
  await $fetch(`/api/conversations/${id}`, {
    method: 'PATCH',
    body: { archived },
  })
  refreshConversations()
  refreshArchived()
  if (archived && conversationId.value === id)
    startNewConversation()
}
</script>

<template>
  <div class="h-[calc(100dvh-3.5rem)] flex flex-col">
    <div class="flex-1 flex overflow-hidden">
      <aside
        class="w-72 border-r border-gray-200 flex-col bg-white"
        :class="sidebarOpen
          ? 'flex fixed inset-y-0 left-0 z-50 md:static md:z-auto'
          : 'hidden md:flex'"
      >
        <chat-sidebar
          :conversations="sidebarConversations"
          :archived-conversations="sidebarArchived"
          :selected-id="conversationId"
          @select="selectConversation"
          @new-conversation="startNewConversation"
          @archive="id => setArchived(id, true)"
          @unarchive="id => setArchived(id, false)"
        />
      </aside>

      <div v-if="sidebarOpen" class="fixed inset-0 z-40 bg-black/40 md:hidden" @click="sidebarOpen = false" />

      <main class="flex-1 flex flex-col bg-white overflow-hidden">
        <div class="shrink-0 flex items-center border-b border-gray-200 px-3 py-2 md:hidden">
          <button
            type="button"
            aria-label="Open chat sidebar"
            class="inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            @click="sidebarOpen = true"
          >
            <Bars3Icon class="h-5 w-5" />
          </button>
        </div>

        <chat-thread v-if="messages.length > 0" :messages="messages" @edit="startEdit" />
        <div v-else class="flex-1 flex flex-col items-center justify-center overflow-y-auto p-6 text-center">
          <div class="max-w-md">
            <h2 class="text-2xl font-semibold text-gray-900 mb-2">
              {{ t('chat.firstQuery.title') }}
            </h2>
            <p class="text-gray-500 mb-8">
              {{ t('chat.firstQuery.subtitle') }}
            </p>

            <p class="text-xs font-medium uppercase tracking-wider text-gray-400 mb-3">
              {{ t('chat.firstQuery.suggestionTitle') }}
            </p>
            <div class="space-y-3">
              <button
                v-for="(suggestion, index) in suggestedQueries"
                :key="index"
                type="button"
                class="w-full flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left text-sm text-gray-700 shadow-sm hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                @click="sendSuggestedQuery(suggestion.text)"
              >
                <component :is="suggestion.icon" class="h-5 w-5 text-indigo-500 shrink-0" />
                <span>{{ suggestion.text }}</span>
              </button>
            </div>
          </div>
        </div>

        <chat-activity v-if="activities.length > 0" :activities="activities" />

        <div class="shrink-0 border-t border-gray-200 p-4 bg-white">
          <div v-if="error" class="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-800">
            {{ error }}
          </div>

          <div v-if="editingMessage" class="mb-2 flex items-center justify-between rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs text-amber-800">
            <span>{{ t('chat.editingNotice') }}</span>
            <button type="button" class="text-amber-600 hover:text-amber-800" @click="cancelEdit">
              <XMarkIcon class="h-4 w-4" />
            </button>
          </div>

          <div class="flex items-end gap-2">
            <textarea
              ref="queryInput"
              v-model="queryText"
              rows="1"
              :placeholder="t('chat.placeholder')"
              class="flex-1 min-h-[2.75rem] max-h-40 resize-y block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm px-3 py-2"
              :disabled="isStreaming"
              @keydown="handleKeydown"
            />
            <button
              class="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="isStreaming || !queryText.trim()"
              @click="handleSubmit"
            >
              <span v-if="isStreaming" class="flex items-center">
                <SparklesIcon class="h-4 w-4 mr-1.5 animate-pulse" />
                {{ t('chat.streaming') }}
              </span>
              <span v-else class="flex items-center">
                <PaperAirplaneIcon class="h-4 w-4 mr-1.5" />
                {{ t('chat.send') }}
              </span>
            </button>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
