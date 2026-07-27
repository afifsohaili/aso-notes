<script setup lang="ts">
import type { ChatConversationSummary } from '~/components/chat/chat-sidebar.vue'
import type { ChatMessage } from '~/composables/use-chat'
import { useI18n } from 'vue-i18n'
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
  middleware: ['auth'],
  layout: 'default',
})

const route = useRoute()
const router = useRouter()

const conversationId = ref<string | null>(
  typeof route.query.conversationId === 'string' ? route.query.conversationId : null,
)

const { data: conversations, refresh: refreshConversations } = await useFetch<ChatConversationSummary[]>('/api/conversations')
const { data: archivedConversations, refresh: refreshArchived } = await useFetch<ChatConversationSummary[]>('/api/conversations?archived=true')

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
  reset()
  cancelEdit()
  conversationId.value = id
}

function startNewConversation() {
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
      <aside class="w-72 border-r border-gray-200 flex flex-col">
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

      <main class="flex-1 flex flex-col bg-white overflow-hidden">
        <chat-thread v-if="messages.length > 0" :messages="messages" @edit="startEdit" />
        <div v-else class="flex-1 flex items-center justify-center text-gray-500">
          {{ t('chat.empty') }}
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
