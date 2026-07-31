<script setup lang="ts">
import type { NoteDetailNote } from '~/components/notes/note-detail.vue'
import type { NoteListItem } from '~/components/notes/note-list.vue'
import type { SyncedFolderGroup } from '~/components/notes/notes-layout.vue'
import { useI18n } from 'vue-i18n'

type ResolveResponse
  = | { type: 'note', path: string, folder: string | null, syncedFolderId: string }
    | { type: 'folder', path: string, syncedFolderId: string }
    | { type: 'not_found' }

interface PageData {
  resolved: ResolveResponse
  groups: SyncedFolderGroup[]
  notes: NoteListItem[]
  note: NoteDetailNote | null
  selectedSyncedFolderId: string | null
  selectedFolderPath: string | null
  selectedNotePath: string | null
}

definePageMeta({
  middleware: ['auth'],
  layout: 'default',
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const rawPath = computed(() => (route.params.path as string[]).join('/'))
const syncedFolderId = computed(() => typeof route.query.syncedFolder === 'string' ? route.query.syncedFolder : null)

const { data: pageData, error, refresh } = await useAsyncData<PageData>(
  () => `notes-page-${rawPath.value}-${syncedFolderId.value ?? 'none'}`,
  async () => {
    const resolveUrl = syncedFolderId.value
      ? `/api/notes/resolve?path=${encodeURIComponent(rawPath.value)}&syncedFolder=${encodeURIComponent(syncedFolderId.value)}`
      : `/api/notes/resolve?path=${encodeURIComponent(rawPath.value)}`

    const resolved = await $fetch<ResolveResponse>(resolveUrl)

    if (resolved.type === 'not_found') {
      throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }

    const folderPath = resolved.type === 'note' ? resolved.folder : resolved.path
    const notePath = resolved.type === 'note' ? resolved.path : null
    const resolvedSyncedFolderId = resolved.syncedFolderId

    const [groups, notes, note] = await Promise.all([
      $fetch<SyncedFolderGroup[]>('/api/folders'),
      $fetch<NoteListItem[]>(`/api/notes?syncedFolder=${encodeURIComponent(resolvedSyncedFolderId)}&folder=${encodeURIComponent(folderPath ?? '')}`),
      notePath ? $fetch<NoteDetailNote>(`/api/notes${notePath}?syncedFolder=${encodeURIComponent(resolvedSyncedFolderId)}`) : Promise.resolve(null),
    ])

    return {
      resolved,
      groups,
      notes,
      note,
      selectedSyncedFolderId: resolvedSyncedFolderId,
      selectedFolderPath: folderPath,
      selectedNotePath: notePath,
    }
  },
  {
    watch: [rawPath, syncedFolderId],
  },
)

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

const selectedSyncedFolderId = computed(() => pageData.value?.selectedSyncedFolderId ?? null)
const selectedFolderPath = computed(() => pageData.value?.selectedFolderPath ?? null)
const selectedNotePath = computed(() => pageData.value?.selectedNotePath ?? null)

const processing = ref(false)
const processMessage = ref('')

async function saveNote(content: string) {
  if (!selectedNotePath.value || !selectedSyncedFolderId.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}?syncedFolder=${selectedSyncedFolderId.value}`, {
    method: 'PUT',
    body: { content },
  })
  await refresh()
}

async function addTag(name: string) {
  if (!selectedNotePath.value || !selectedSyncedFolderId.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}/tags?syncedFolder=${selectedSyncedFolderId.value}`, {
    method: 'POST',
    body: { name },
  })
  await refresh()
}

async function removeTag(tagId: string) {
  if (!selectedNotePath.value || !selectedSyncedFolderId.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}/tags/${tagId}?syncedFolder=${selectedSyncedFolderId.value}`, {
    method: 'DELETE',
  })
  await refresh()
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
  await refresh()
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
    await refresh()
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
    :groups="pageData?.groups ?? []"
    :selected-synced-folder-id="selectedSyncedFolderId"
    :selected-folder-path="selectedFolderPath"
    :selected-note-path="selectedNotePath"
    :notes="pageData?.notes ?? []"
    :note="pageData?.note ?? null"
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
