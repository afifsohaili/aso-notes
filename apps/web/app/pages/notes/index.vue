<script setup lang="ts">
import type { FolderNode } from '~/components/notes/folder-tree.vue'
import type { NoteDetailNote } from '~/components/notes/note-detail.vue'
import type { NoteListItem } from '~/components/notes/note-list.vue'
import { useI18n } from 'vue-i18n'

definePageMeta({
  middleware: ['auth'],
  layout: 'default',
})

const { t } = useI18n()

const selectedFolderPath = ref<string | null>(null)
const selectedNotePath = ref<string | null>(null)

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
        <h2 class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {{ t('notes.notes') }}
        </h2>
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
