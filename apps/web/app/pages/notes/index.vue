<script setup lang="ts">
import type { FolderNode } from '~/components/notes/folder-tree.vue'
import type { NoteDetailNote } from '~/components/notes/note-detail.vue'
import type { NoteListItem } from '~/components/notes/note-list.vue'
import { useI18n } from 'vue-i18n'

definePageMeta({
  middleware: ['auth', 'onboarding'],
  layout: 'default',
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

// Redirect old ?note= URLs to the canonical path-based URL.
if (typeof route.query.note === 'string' && route.query.note) {
  await navigateTo(`/notes${route.query.note}`, { replace: true })
}

const { data: folders } = await useFetch<FolderNode[]>('/api/folders')

const selectedFolderPath = ref<string | null>(null)
const selectedNotePath = ref<string | null>(null)

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

const processing = ref(false)
const processMessage = ref('')

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

async function createNote(path: string) {
  await $fetch(`/api/notes${path}`, {
    method: 'PUT',
    body: { content: '' },
  })
  await navigateTo(`/notes${path}?edit=1`, { replace: true })
}

async function processFolder(folder: string) {
  processing.value = true
  processMessage.value = ''
  try {
    const res = await $fetch<{ dispatched: number }>('/api/notes/process', {
      method: 'POST',
      body: { folder },
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

function onEditingStarted() {
  if (route.query.edit === '1') {
    router.replace({ query: { ...route.query, edit: undefined } })
  }
}

function selectFolder(path: string) {
  navigateTo(`/notes${path}`)
}

function selectNote(path: string) {
  navigateTo(`/notes${path}`)
}
</script>

<template>
  <notes-layout
    :folders="folders ?? []"
    :selected-folder-path="selectedFolderPath"
    :selected-note-path="selectedNotePath"
    :notes="notes ?? []"
    :note="note ?? null"
    :processing="processing"
    :process-message="processMessage"
    :start-editing="route.query.edit === '1'"
    @select-folder="selectFolder"
    @select-note="selectNote"
    @save-note="saveNote"
    @add-tag="addTag"
    @remove-tag="removeTag"
    @retry="retryNote"
    @create-note="createNote"
    @process-folder="processFolder"
    @editing-started="onEditingStarted"
  />
</template>
