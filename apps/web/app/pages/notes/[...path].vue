<script setup lang="ts">
import type { FolderNode } from '~/components/notes/folder-tree.vue'
import type { NoteDetailNote } from '~/components/notes/note-detail.vue'
import type { NoteListItem } from '~/components/notes/note-list.vue'
import { useI18n } from 'vue-i18n'

type ResolveResponse
  = | { type: 'note', path: string, folder: string | null }
    | { type: 'folder', path: string }
    | { type: 'not_found' }

interface PageData {
  resolved: ResolveResponse
  folders: FolderNode[]
  notes: NoteListItem[]
  note: NoteDetailNote | null
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

const { data: pageData, error, refresh } = await useAsyncData<PageData>(
  () => `notes-page-${rawPath.value}`,
  async () => {
    const resolved = await $fetch<ResolveResponse>(
      `/api/notes/resolve?path=${encodeURIComponent(rawPath.value)}`,
    )

    if (resolved.type === 'not_found') {
      throw createError({ statusCode: 404, statusMessage: 'Not found' })
    }

    const folderPath = resolved.type === 'note' ? resolved.folder : resolved.path
    const notePath = resolved.type === 'note' ? resolved.path : null

    const [folders, notes, note] = await Promise.all([
      $fetch<FolderNode[]>('/api/folders'),
      $fetch<NoteListItem[]>(`/api/notes?folder=${encodeURIComponent(folderPath ?? '')}`),
      notePath ? $fetch<NoteDetailNote>(`/api/notes${notePath}`) : Promise.resolve(null),
    ])

    return {
      resolved,
      folders,
      notes,
      note,
      selectedFolderPath: folderPath,
      selectedNotePath: notePath,
    }
  },
  {
    watch: [rawPath],
  },
)

if (error.value) {
  throw createError({ statusCode: 404, statusMessage: 'Not found' })
}

const selectedFolderPath = computed(() => pageData.value?.selectedFolderPath ?? null)
const selectedNotePath = computed(() => pageData.value?.selectedNotePath ?? null)

const processing = ref(false)
const processMessage = ref('')

async function saveNote(content: string) {
  if (!selectedNotePath.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}`, {
    method: 'PUT',
    body: { content },
  })
  await refresh()
}

async function addTag(name: string) {
  if (!selectedNotePath.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}/tags`, {
    method: 'POST',
    body: { name },
  })
  await refresh()
}

async function removeTag(tagId: string) {
  if (!selectedNotePath.value)
    return
  await $fetch(`/api/notes${selectedNotePath.value}/tags/${tagId}`, {
    method: 'DELETE',
  })
  await refresh()
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
  await refresh()
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

function selectFolder(path: string) {
  navigateTo(`/notes${path}`)
}

function selectNote(path: string) {
  navigateTo(`/notes${path}`)
}
</script>

<template>
  <notes-layout
    :folders="pageData?.folders ?? []"
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
