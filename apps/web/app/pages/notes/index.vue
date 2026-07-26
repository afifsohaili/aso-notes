<script setup lang="ts">
import type { FolderNode } from '~/components/notes/folder-tree.vue'
import type { NoteDetailNote } from '~/components/notes/note-detail.vue'
import type { NoteListItem } from '~/components/notes/note-list.vue'
import { useI18n } from 'vue-i18n'
import BoltIcon from '~icons/heroicons/bolt'

definePageMeta({
  middleware: ['auth'],
  layout: 'default',
})

const { t } = useI18n()

const route = useRoute()

const selectedFolderPath = ref<string | null>(null)
const selectedNotePath = ref<string | null>(typeof route.query.note === 'string' ? route.query.note : null)

const { data: folders } = await useFetch<FolderNode[]>('/api/folders')

const { data: notes, refresh: refreshNotes } = await useFetch<NoteListItem[]>('/api/notes', {
  query: computed(() => ({
    folder: selectedFolderPath.value ?? '',
  })),
  watch: [selectedFolderPath],
})

const { data: note, refresh: refreshNote } = useFetch<NoteDetailNote>(() => selectedNotePath.value ? `/api/notes${selectedNotePath.value}` : null, {
  key: computed(() => `note-${selectedNotePath.value ?? 'none'}`),
  watch: [selectedNotePath],
})

function selectFolder(path: string) {
  selectedFolderPath.value = path
  selectedNotePath.value = null
}

function selectNote(path: string) {
  selectedNotePath.value = path
}

async function saveNote(content: string) {
  if (!selectedNotePath.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}`, {
    method: 'PUT',
    body: { content },
  })
  await refreshNote()
  await refreshNotes()
}

async function addTag(name: string) {
  if (!selectedNotePath.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}/tags`, {
    method: 'POST',
    body: { name },
  })
  await refreshNote()
  await refreshNotes()
}

async function removeTag(tagId: string) {
  if (!selectedNotePath.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}/tags/${tagId}`, {
    method: 'DELETE',
  })
  await refreshNote()
  await refreshNotes()
}

const processing = ref(false)
const processMessage = ref('')

const pendingCount = computed(() => (notes.value ?? []).filter(n => n.status === 'pending').length)

async function processFolder() {
  if (!selectedFolderPath.value || processing.value)
    return

  processing.value = true
  processMessage.value = ''
  try {
    const res = await $fetch<{ dispatched: number }>('/api/notes/process', {
      method: 'POST',
      body: { folder: selectedFolderPath.value },
    })
    processMessage.value = t('notes.processDispatched', { count: res.dispatched })
    await refreshNotes()
  }
  catch {
    processMessage.value = t('notes.processError')
  }
  finally {
    processing.value = false
  }
}
</script>

<template>
  <div class="h-screen flex flex-col">
    <header class="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
      <h1 class="text-lg font-semibold text-gray-900">
        {{ t('notes.title') }}
      </h1>
    </header>

    <div class="flex-1 flex overflow-hidden">
      <!-- Folder tree -->
      <aside class="w-64 border-r border-gray-200 bg-white overflow-y-auto flex flex-col">
        <h2 class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {{ t('notes.folders') }}
        </h2>
        <folder-tree
          :folders="folders ?? []"
          :selected-path="selectedFolderPath"
          @select="selectFolder"
        />
      </aside>

      <!-- Note list -->
      <aside class="w-80 border-r border-gray-200 bg-white flex flex-col">
        <div class="flex items-center justify-between px-4 py-2">
          <h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            {{ t('notes.notes') }}
          </h2>
          <button
            v-if="selectedFolderPath && pendingCount > 0"
            type="button"
            class="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
            :disabled="processing"
            @click="processFolder"
          >
            <BoltIcon class="w-3.5 h-3.5" />
            {{ processing ? t('notes.processing') : t('notes.processPending', { count: pendingCount }) }}
          </button>
        </div>
        <p v-if="processMessage" class="px-4 pb-2 text-xs text-gray-500">
          {{ processMessage }}
        </p>
        <note-list
          :notes="notes ?? []"
          :selected-path="selectedNotePath"
          @select="selectNote"
        />
      </aside>

      <!-- Note detail -->
      <main class="flex-1 bg-white overflow-hidden">
        <note-detail
          v-if="selectedNotePath && note"
          :note="note"
          @save="saveNote"
          @add-tag="addTag"
          @remove-tag="removeTag"
        />
        <div v-else class="h-full flex items-center justify-center text-gray-500">
          {{ t('notes.selectNote') }}
        </div>
      </main>
    </div>
  </div>
</template>
