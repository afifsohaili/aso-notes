<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ArrowPathIcon from '~icons/heroicons/arrow-path'
import DocumentIcon from '~icons/heroicons/document-text'
import ExclamationTriangleIcon from '~icons/heroicons/exclamation-triangle'

export interface NoteListItem {
  path: string
  title: string
  status: string
  tags: { id: string, name: string, origin: string }[]
  updatedAt: string
  lastRun: {
    status: 'succeeded' | 'failed'
    error: { message: string } | null
  } | null
}

const props = defineProps<{
  notes: NoteListItem[]
  selectedPath: string | null
}>()

const emit = defineEmits<{
  (e: 'select', path: string): void
  (e: 'retry', path: string): void
}>()

const { t } = useI18n()

const statusClasses: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  queued: 'bg-blue-100 text-blue-800',
  processing: 'bg-indigo-100 text-indigo-800 animate-pulse',
  ingested: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

function statusClass(status: string): string {
  return statusClasses[status] ?? 'bg-gray-100 text-gray-800'
}

function isFailed(note: NoteListItem): boolean {
  return note.status === 'failed' || note.lastRun?.status === 'failed'
}
</script>

<template>
  <div class="overflow-y-auto h-full">
    <ul class="divide-y divide-gray-200">
      <li
        v-for="note in props.notes"
        :key="note.path"
        data-testid="note-list-item"
        class="px-4 py-3 hover:bg-gray-50 cursor-pointer"
        :class="selectedPath === note.path ? 'bg-indigo-50' : ''"
        @click="emit('select', note.path)"
      >
        <div class="flex items-start gap-3">
          <DocumentIcon class="h-5 w-5 text-gray-400 mt-0.5" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between">
              <p class="text-sm font-medium text-gray-900 truncate">
                {{ note.title }}
              </p>
              <span class="flex items-center gap-1">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize"
                  :class="statusClass(note.status)"
                >
                  {{ t(`notes.status.${note.status}`) }}
                </span>
                <span
                  v-if="isFailed(note)"
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800"
                  :title="note.lastRun?.error?.message ?? t('notes.lastRun.errorTooltip')"
                >
                  <ExclamationTriangleIcon class="h-3 w-3" />
                  <span class="truncate max-w-[120px]">
                    {{ note.lastRun?.error?.message ?? t('notes.lastRun.errorTooltip') }}
                  </span>
                </span>
                <button
                  v-if="note.status === 'failed'"
                  type="button"
                  class="p-1 rounded text-red-500 hover:text-red-700 hover:bg-red-50"
                  title="Retry ingestion"
                  @click.stop="emit('retry', note.path)"
                >
                  <ArrowPathIcon class="h-4 w-4" />
                </button>
              </span>
            </div>
            <p class="text-xs text-gray-500 truncate mt-0.5">
              {{ note.path }}
            </p>
            <div v-if="note.tags.length > 0" class="flex flex-wrap gap-1 mt-2">
              <span
                v-for="tag in note.tags"
                :key="tag.id"
                class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700"
              >
                {{ tag.name }}
              </span>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
