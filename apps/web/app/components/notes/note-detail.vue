<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ArrowPathIcon from '~icons/heroicons/arrow-path'
import DocumentIcon from '~icons/heroicons/document-text'
import ExclamationTriangleIcon from '~icons/heroicons/exclamation-triangle'
import PencilIcon from '~icons/heroicons/pencil'
import XMarkIcon from '~icons/heroicons/x-mark'

const props = withDefaults(defineProps<{
  note: NoteDetailNote
  startEditing?: boolean
}>(), {
  startEditing: false,
})

const emit = defineEmits<{
  (e: 'save', content: string): void
  (e: 'addTag', name: string): void
  (e: 'removeTag', tagId: string): void
  (e: 'editingStarted'): void
  (e: 'retry'): void
}>()

const { t } = useI18n()

export interface NoteDetailNote {
  path: string
  title: string
  content: string
  renderMarkdown: boolean
  status: string
  folder: string | null
  tags: { id: string, name: string, origin: string }[]
  sources: { url: string, type: string | null }[]
  updatedAt: string
  lastRun: LastRunDetail | null
}

interface LastRunDetail {
  pipeline: string
  status: 'succeeded' | 'failed'
  failed_stage: string | null
  error: { name: string, message: string, stack?: string } | null
  attempt: number
  job_id: string | null
  started_at: string
  finished_at: string
  duration_ms: number
  chunks: number | null
  extraction: {
    strategy: string
    model: string
    messages: { role: string, content: string }[]
    response: string
    usage: { prompt_tokens: number, completion_tokens: number } | null
    counts: { concepts: number, relations: number, mentions: number, tags: number }
  } | null
}

const isEditing = ref(false)
const draftContent = ref('')
const newTagName = ref('')
const showMessages = ref(false)
const showResponse = ref(false)

const isFailed = computed(() => props.note.status === 'failed' || props.note.lastRun?.status === 'failed')

const prettyResponse = computed(() => {
  const raw = props.note.lastRun?.extraction?.response
  if (!raw)
    return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  }
  catch {
    return raw
  }
})

function formatDuration(ms: number): string {
  if (ms < 1000)
    return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatTokens(usage: { prompt_tokens: number, completion_tokens: number } | null): string {
  if (!usage)
    return '-'
  return `${usage.prompt_tokens} / ${usage.completion_tokens}`
}

watch(() => props.startEditing, (value) => {
  if (value) {
    startEdit()
    emit('editingStarted')
  }
}, { immediate: true })

function startEdit() {
  draftContent.value = props.note.content
  isEditing.value = true
}

function cancelEdit() {
  isEditing.value = false
  draftContent.value = ''
}

function saveEdit() {
  emit('save', draftContent.value)
  isEditing.value = false
}

function handleAddTag() {
  const name = newTagName.value.trim()
  if (!name)
    return
  emit('addTag', name)
  newTagName.value = ''
}

const statusClasses: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  ingested: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

function statusClass(status: string): string {
  return statusClasses[status] ?? 'bg-gray-100 text-gray-800'
}
</script>

<template>
  <div class="flex flex-col h-full overflow-y-auto p-6">
    <div class="flex items-start justify-between mb-4">
      <div>
        <h1 class="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          <DocumentIcon class="h-6 w-6 text-gray-500" />
          {{ note.title }}
        </h1>
        <p class="text-sm text-gray-500 mt-1">
          {{ note.path }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize"
          :class="statusClass(note.status)"
        >
          {{ note.status }}
        </span>
        <span
          v-if="isFailed"
          class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"
          :title="note.lastRun?.error?.message ?? t('notes.lastRun.errorTooltip')"
        >
          <ExclamationTriangleIcon class="h-3 w-3" />
          {{ t('notes.lastRun.errorTooltip') }}
        </span>
        <button
          v-if="note.status === 'failed' && !isEditing"
          class="inline-flex items-center px-3 py-1.5 border border-red-300 shadow-sm text-sm font-medium rounded-md text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          @click="emit('retry')"
        >
          <ArrowPathIcon class="h-4 w-4 mr-1.5" />
          {{ t('notes.retry') }}
        </button>
        <button
          v-if="!isEditing"
          class="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          @click="startEdit"
        >
          <PencilIcon class="h-4 w-4 mr-1.5" />
          {{ t('notes.edit') }}
        </button>
      </div>
    </div>

    <div v-if="note.folder" class="mb-4 text-sm text-gray-600">
      {{ t('notes.folder') }}: {{ note.folder }}
    </div>

    <div v-if="isEditing" class="flex flex-col flex-1 gap-4">
      <textarea
        v-model="draftContent"
        rows="20"
        class="flex-1 min-h-[200px] block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm font-mono"
      />
      <div class="flex items-center justify-end gap-2">
        <button
          class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          @click="cancelEdit"
        >
          <XMarkIcon class="h-4 w-4 mr-1.5" />
          {{ t('notes.cancel') }}
        </button>
        <button
          class="inline-flex items-center px-3 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          @click="saveEdit"
        >
          {{ t('notes.save') }}
        </button>
      </div>
    </div>

    <div v-else class="flex-1">
      <markdown-renderer v-if="note.renderMarkdown" :content="note.content" />
      <pre v-else class="whitespace-pre-wrap font-mono text-sm text-gray-800">{{ note.content }}</pre>
    </div>

    <div class="mt-8 border-t pt-6">
      <h3 class="text-sm font-medium text-gray-900 mb-3">
        {{ t('notes.tags') }}
      </h3>
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <span
          v-for="tag in note.tags || []"
          :key="tag.id"
          class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800"
        >
          {{ tag.name }}
          <span
            v-if="tag.origin === 'ai'"
            class="ml-1.5 text-indigo-600"
            :title="t('notes.aiTag')"
          >
            ✨
          </span>
          <button
            class="ml-1.5 text-indigo-600 hover:text-indigo-900"
            @click="emit('removeTag', tag.id)"
          >
            <XMarkIcon class="h-3 w-3" />
          </button>
        </span>
      </div>
      <form class="flex items-center gap-2" @submit.prevent="handleAddTag">
        <input
          v-model="newTagName"
          type="text"
          :placeholder="t('notes.addTagPlaceholder')"
          class="block w-48 border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        >
        <button
          type="submit"
          class="inline-flex items-center px-3 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          {{ t('notes.addTag') }}
        </button>
      </form>
    </div>

    <div v-if="note.sources?.length" class="mt-6 border-t pt-6">
      <h3 class="text-sm font-medium text-gray-900 mb-3">
        {{ t('notes.sources') }}
      </h3>
      <ul class="space-y-2">
        <li v-for="(source, index) in note.sources" :key="index" class="text-sm">
          <a
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
            class="text-indigo-600 hover:text-indigo-900"
          >
            {{ source.url }}
          </a>
          <span v-if="source.type" class="ml-2 text-xs text-gray-500">({{ source.type }})</span>
        </li>
      </ul>
    </div>

    <div v-if="note.lastRun" class="mt-6 border-t pt-6">
      <details>
        <summary class="cursor-pointer list-none">
          <h3 class="text-sm font-medium text-gray-900 inline-flex items-center gap-2">
            {{ t('notes.lastRun.title') }}
            <span
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize"
              :class="statusClass(note.lastRun.status)"
            >
              {{ note.lastRun.status }}
            </span>
            <span
              v-if="note.lastRun.error"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"
              :title="note.lastRun.error.message"
            >
              <ExclamationTriangleIcon class="h-3 w-3" />
              {{ note.lastRun.error.message }}
            </span>
          </h3>
        </summary>

        <div class="mt-4 space-y-3 text-sm text-gray-700">
          <dl class="grid grid-cols-2 gap-3">
            <div>
              <dt class="text-xs text-gray-500">
                {{ t('notes.lastRun.pipeline') }}
              </dt>
              <dd class="font-mono text-xs">
                {{ note.lastRun.pipeline }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500">
                {{ t('notes.lastRun.duration') }}
              </dt>
              <dd>{{ formatDuration(note.lastRun.duration_ms) }}</dd>
            </div>
            <div v-if="note.lastRun.failed_stage">
              <dt class="text-xs text-gray-500">
                {{ t('notes.lastRun.failedStage') }}
              </dt>
              <dd class="font-mono text-xs text-red-700">
                {{ note.lastRun.failed_stage }}
              </dd>
            </div>
            <div>
              <dt class="text-xs text-gray-500">
                {{ t('notes.lastRun.chunks') }}
              </dt>
              <dd>{{ note.lastRun.chunks ?? '-' }}</dd>
            </div>
          </dl>

          <div v-if="note.lastRun.extraction" class="border-t pt-3 space-y-3">
            <dl class="grid grid-cols-2 gap-3">
              <div>
                <dt class="text-xs text-gray-500">
                  {{ t('notes.lastRun.strategy') }}
                </dt>
                <dd class="font-mono text-xs">
                  {{ note.lastRun.extraction.strategy }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-gray-500">
                  {{ t('notes.lastRun.model') }}
                </dt>
                <dd class="font-mono text-xs">
                  {{ note.lastRun.extraction.model }}
                </dd>
              </div>
              <div>
                <dt class="text-xs text-gray-500">
                  {{ t('notes.lastRun.tokens') }}
                </dt>
                <dd>{{ formatTokens(note.lastRun.extraction.usage) }}</dd>
              </div>
              <div>
                <dt class="text-xs text-gray-500">
                  {{ t('notes.lastRun.counts') }}
                </dt>
                <dd>
                  {{ note.lastRun.extraction.counts.concepts }} concepts,
                  {{ note.lastRun.extraction.counts.relations }} relations,
                  {{ note.lastRun.extraction.counts.mentions }} mentions,
                  {{ note.lastRun.extraction.counts.tags }} tags
                </dd>
              </div>
            </dl>

            <div>
              <button
                type="button"
                class="text-sm text-indigo-600 hover:text-indigo-900"
                @click="showMessages = !showMessages"
              >
                {{ showMessages ? t('notes.lastRun.hideMessages') : t('notes.lastRun.showMessages') }}
              </button>
              <div v-if="showMessages" data-testid="last-run-messages" class="mt-2 space-y-2">
                <div
                  v-for="(message, index) in note.lastRun.extraction.messages"
                  :key="index"
                  class="border rounded-md overflow-hidden"
                >
                  <div class="bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700 capitalize">
                    {{ message.role }}
                  </div>
                  <pre class="p-3 whitespace-pre-wrap font-mono text-xs text-gray-800">{{ message.content }}</pre>
                </div>
              </div>
            </div>

            <div>
              <button
                type="button"
                class="text-sm text-indigo-600 hover:text-indigo-900"
                @click="showResponse = !showResponse"
              >
                {{ showResponse ? t('notes.lastRun.hideResponse') : t('notes.lastRun.showResponse') }}
              </button>
              <pre
                v-if="showResponse"
                data-testid="last-run-response"
                class="mt-2 p-3 whitespace-pre-wrap font-mono text-xs text-gray-800 bg-gray-50 rounded-md overflow-x-auto"
              >{{ prettyResponse }}</pre>
            </div>
          </div>

          <div v-else class="text-sm text-gray-500 italic">
            {{ t('notes.lastRun.noExtraction') }}
          </div>
        </div>
      </details>
    </div>
  </div>
</template>
