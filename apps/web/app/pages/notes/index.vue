<script setup lang="ts">
import type { NoteDetailNote } from '~/components/notes/note-detail.vue'
import type { NoteListItem } from '~/components/notes/note-list.vue'
import type { SyncedFolderGroup } from '~/components/notes/notes-layout.vue'
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

const { data: groups } = await useFetch<SyncedFolderGroup[]>('/api/folders')

// Selection follows the route: folder clicks navigate (?syncedFolder=...),
// so derive state from the query reactively instead of capturing it once.
const selectedSyncedFolderId = computed(() => typeof route.query.syncedFolder === 'string' && route.query.syncedFolder !== '' ? route.query.syncedFolder : null)
const selectedFolderPath = computed(() => selectedSyncedFolderId.value ? '/' : null)
const selectedNotePath = ref<string | null>(null)

const { data: notes, refresh: refreshNotes } = await useFetch<NoteListItem[]>('/api/notes', {
  query: computed(() => ({
    syncedFolder: selectedSyncedFolderId.value ?? '',
    folder: selectedFolderPath.value ?? '',
  })),
  watch: [selectedSyncedFolderId, selectedFolderPath],
})

const { data: note, refresh: refreshNote } = useFetch<NoteDetailNote>(() => selectedNotePath.value && selectedSyncedFolderId.value ? `/api/notes${selectedNotePath.value}?syncedFolder=${selectedSyncedFolderId.value}` : null, {
  key: computed(() => `note-${selectedNotePath.value ?? 'none'}-${selectedSyncedFolderId.value ?? 'none'}`),
  watch: [selectedNotePath, selectedSyncedFolderId],
})

const processing = ref(false)
const processMessage = ref('')

async function saveNote(content: string) {
  if (!selectedNotePath.value || !selectedSyncedFolderId.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}?syncedFolder=${selectedSyncedFolderId.value}`, {
    method: 'PUT',
    body: { content },
  })
  await refreshNote()
  await refreshNotes()
}

async function addTag(name: string) {
  if (!selectedNotePath.value || !selectedSyncedFolderId.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}/tags?syncedFolder=${selectedSyncedFolderId.value}`, {
    method: 'POST',
    body: { name },
  })
  await refreshNote()
  await refreshNotes()
}

async function removeTag(tagId: string) {
  if (!selectedNotePath.value || !selectedSyncedFolderId.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}/tags/${tagId}?syncedFolder=${selectedSyncedFolderId.value}`, {
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
      body: { path, syncedFolder: selectedSyncedFolderId.value },
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
  await navigateTo(`/notes${path}?edit=1&syncedFolder=${selectedSyncedFolderId.value ?? ''}`, { replace: true })
}

async function processFolder(path: string) {
  processing.value = true
  processMessage.value = ''
  try {
    const res = await $fetch<{ dispatched: number }>('/api/notes/process', {
      method: 'POST',
      body: { folder: path, syncedFolder: selectedSyncedFolderId.value },
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

function selectFolder(syncedFolderId: string, folderPath: string) {
  const pathParam = folderPath === '/' ? '' : folderPath
  navigateTo(`/notes${pathParam}?syncedFolder=${syncedFolderId}`)
}

function selectNote(path: string) {
  navigateTo(`/notes${path}?syncedFolder=${selectedSyncedFolderId.value ?? ''}`)
}
</script>

<template>
  <notes-layout
    :groups="groups ?? []"
    :selected-synced-folder-id="selectedSyncedFolderId"
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
