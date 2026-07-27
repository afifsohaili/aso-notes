<script setup lang="ts">
import type { FolderNode } from '~/components/notes/folder-tree.vue'
import type { NoteDetailNote } from '~/components/notes/note-detail.vue'
import type { NoteListItem } from '~/components/notes/note-list.vue'
import { useI18n } from 'vue-i18n'
import BoltIcon from '~icons/heroicons/bolt'
import PlusIcon from '~icons/heroicons/plus'

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

async function retryNote(path: string) {
  processMessage.value = ''
  try {
    await $fetch('/api/notes/retry', {
      method: 'POST',
      body: { path },
    })
    processMessage.value = t('notes.retryDispatched')
  }
  catch {
    processMessage.value = t('notes.processError')
  }
  await refreshNotes()
  await refreshNote()
}

const addingNote = ref(false)
const newNoteName = ref('')
const newNoteError = ref('')
const newNoteInput = ref<HTMLInputElement | null>(null)
const startEditingNewNote = ref(false)

function startAddNote() {
  addingNote.value = true
  newNoteError.value = ''
  nextTick(() => newNoteInput.value?.focus())
}

function cancelAddNote() {
  addingNote.value = false
  newNoteName.value = ''
  newNoteError.value = ''
}

function slugifyNoteName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

async function createNote() {
  const slug = slugifyNoteName(newNoteName.value)
  if (!slug) {
    cancelAddNote()
    return
  }

  const folder = selectedFolderPath.value ?? ''
  const path = `${folder}/${slug}.md`

  if ((notes.value ?? []).some(n => n.path === path)) {
    newNoteError.value = t('notes.addNoteExists')
    return
  }

  await $fetch(`/api/notes${path}`, {
    method: 'PUT',
    body: { content: '' },
  })

  cancelAddNote()
  await refreshNotes()
  startEditingNewNote.value = true
  selectNote(path)
}

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
  <div class="h-[calc(100dvh-3.5rem)] flex flex-col">
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
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
              :title="t('notes.addNote')"
              @click="startAddNote"
            >
              <PlusIcon class="w-3.5 h-3.5" />
              {{ t('notes.addNote') }}
            </button>
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
        </div>
        <div v-if="addingNote" class="px-4 pb-2">
          <input
            ref="newNoteInput"
            v-model="newNoteName"
            type="text"
            :placeholder="t('notes.addNotePlaceholder')"
            class="w-full border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-indigo-500 focus:border-indigo-500"
            @keydown.enter="createNote"
            @keydown.esc="cancelAddNote"
          >
          <p v-if="newNoteError" class="mt-1 text-xs text-red-600">
            {{ newNoteError }}
          </p>
        </div>
        <p v-if="processMessage" class="px-4 pb-2 text-xs text-gray-500">
          {{ processMessage }}
        </p>
        <note-list
          :notes="notes ?? []"
          :selected-path="selectedNotePath"
          @select="selectNote"
          @retry="retryNote"
        />
      </aside>

      <!-- Note detail -->
      <main class="flex-1 bg-white overflow-hidden">
        <note-detail
          v-if="selectedNotePath && note"
          :note="note"
          :start-editing="startEditingNewNote"
          @save="saveNote"
          @add-tag="addTag"
          @remove-tag="removeTag"
          @editing-started="startEditingNewNote = false"
          @retry="retryNote(selectedNotePath!)"
        />
        <div v-else class="h-full flex items-center justify-center text-gray-500">
          {{ t('notes.selectNote') }}
        </div>
      </main>
    </div>
  </div>
</template>
