<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import FolderIcon from '~icons/heroicons/folder'
import TrashIcon from '~icons/heroicons/trash'
import XCircleIcon from '~icons/heroicons/x-circle'

export interface SyncedFolder {
  id: string
  path: string
  noteCount: number
}

interface Props {
  folders: SyncedFolder[]
  adding?: boolean
  addError?: string
  deleteErrorId?: string
  deleteError?: string
}

const props = withDefaults(defineProps<Props>(), {
  adding: false,
  addError: '',
  deleteErrorId: '',
  deleteError: '',
})

const emit = defineEmits<{
  (e: 'add', path: string): void
  (e: 'delete', id: string): void
}>()

const { t } = useI18n()

const newPath = ref('')

function submit() {
  const path = newPath.value.trim()
  if (!path || props.adding)
    return
  newPath.value = ''
  emit('add', path)
}

function remove(id: string) {
  if (props.adding)
    return
  emit('delete', id)
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-gray-600">
      {{ t('settings.folders.help') }}
    </p>

    <ul v-if="folders.length > 0" class="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
      <li
        v-for="folder in folders"
        :key="folder.id"
        class="flex items-center justify-between px-4 py-3"
      >
        <div class="flex min-w-0 items-center gap-2">
          <FolderIcon class="h-5 w-5 flex-shrink-0 text-gray-400" />>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-gray-900">
              {{ folder.path }}
            </p>
            <p class="text-xs text-gray-500">
              {{ t('settings.folders.noteCount', { count: folder.noteCount }) }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span
            v-if="deleteErrorId === folder.id"
            class="max-w-xs text-right text-xs text-red-600"
            role="alert"
          >
            {{ deleteError }}
          </span>

          <button
            type="button"
            class="inline-flex items-center rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            :title="t('settings.folders.delete')"
            :disabled="folder.noteCount > 0 || adding"
            @click="remove(folder.id)"
          >
            <TrashIcon class="h-4 w-4" />
          </button>
        </div>
      </li>
    </ul>

    <div v-else class="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
      {{ t('settings.folders.empty') }}
    </div>

    <form class="flex flex-col gap-3 sm:flex-row sm:items-start" @submit.prevent="submit">
      <div class="flex-1">
        <input
          v-model="newPath"
          type="text"
          class="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          :placeholder="t('settings.folders.pathPlaceholder')"
          :disabled="adding"
          data-testid="folder-path-input"
        >
        <p
          v-if="addError"
          class="mt-1.5 flex items-center gap-1 text-xs text-red-600"
          role="alert"
          data-testid="folder-add-error"
        >
          <XCircleIcon class="h-3.5 w-3.5" />
          {{ addError }}
        </p>
      </div>

      <button
        type="submit"
        class="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        :disabled="!newPath.trim() || adding"
        data-testid="folder-add-button"
      >
        <span v-if="adding">{{ t('settings.folders.adding') }}</span>
        <span v-else>{{ t('settings.folders.add') }}</span>
      </button>
    </form>
  </div>
</template>
