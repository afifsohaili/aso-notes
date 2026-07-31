<script setup lang="ts">
import type { FolderNode } from '~/components/notes/folder-tree.vue'
import type { NoteDetailNote } from '~/components/notes/note-detail.vue'
import type { NoteListItem } from '~/components/notes/note-list.vue'
import { useI18n } from 'vue-i18n'
import BoltIcon from '~icons/heroicons/bolt'
import ChevronDownIcon from '~icons/heroicons/chevron-down'
import ChevronRightIcon from '~icons/heroicons/chevron-right'
import FolderIcon from '~icons/heroicons/folder'
import PlusIcon from '~icons/heroicons/plus'

export interface SyncedFolderGroup {
  syncedFolderId: string
  name: string
  absolutePath: string
  hasCover: boolean
  noteCount: number
  children: FolderNode[]
}

const props = defineProps<{
  groups: SyncedFolderGroup[]
  selectedSyncedFolderId: string | null
  selectedFolderPath: string | null
  selectedNotePath: string | null
  notes: NoteListItem[]
  note: NoteDetailNote | null
  startEditing?: boolean
  processing?: boolean
  processMessage?: string
}>()

const emit = defineEmits<{
  (e: 'selectFolder', syncedFolderId: string, path: string): void
  (e: 'selectNote', path: string): void
  (e: 'saveNote', content: string): void
  (e: 'addTag', name: string): void
  (e: 'removeTag', tagId: string): void
  (e: 'retry', path: string): void
  (e: 'createNote', path: string): void
  (e: 'processFolder', path: string): void
  (e: 'editingStarted'): void
}>()

const { t } = useI18n()

const pendingCount = computed(() => (props.notes ?? []).filter(n => n.status === 'pending').length)

async function processFolder() {
  if (!props.selectedFolderPath || props.processing)
    return

  emit('processFolder', props.selectedFolderPath)
}

const addingNote = ref(false)
const newNoteName = ref('')
const newNoteError = ref('')
const newNoteInput = ref<HTMLInputElement | null>(null)

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

  const folder = props.selectedFolderPath ?? ''
  const path = `${folder}/${slug}.md`

  if ((props.notes ?? []).some(n => n.path === path)) {
    newNoteError.value = t('notes.addNoteExists')
    return
  }

  cancelAddNote()
  emit('createNote', path)
}

const expandedGroups = ref<Set<string>>(new Set())

function isGroupExpanded(group: SyncedFolderGroup): boolean {
  return expandedGroups.value.has(group.syncedFolderId) || props.selectedSyncedFolderId === group.syncedFolderId
}

function toggleGroup(group: SyncedFolderGroup) {
  const next = new Set(expandedGroups.value)
  if (next.has(group.syncedFolderId))
    next.delete(group.syncedFolderId)
  else
    next.add(group.syncedFolderId)
  expandedGroups.value = next
}

function isGroupSelected(group: SyncedFolderGroup): boolean {
  return props.selectedSyncedFolderId === group.syncedFolderId && (props.selectedFolderPath === null || props.selectedFolderPath === '/')
}

function selectFolder(group: SyncedFolderGroup, folderPath: string) {
  emit('selectFolder', group.syncedFolderId, folderPath)
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
        <div class="p-2">
          <ul class="space-y-1">
            <li v-for="group in groups" :key="group.syncedFolderId" data-testid="folder-tree-group">
              <div class="group">
                <div
                  class="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-gray-100 cursor-pointer"
                  :class="isGroupSelected(group) ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700'"
                  data-testid="folder-tree-row"
                  @click="selectFolder(group, '/')"
                >
                  <button
                    type="button"
                    class="p-0.5 rounded hover:bg-gray-200"
                    @click.stop="toggleGroup(group)"
                  >
                    <ChevronDownIcon v-if="isGroupExpanded(group)" class="h-3.5 w-3.5 text-gray-500" />
                    <ChevronRightIcon v-else-if="group.children.length > 0" class="h-3.5 w-3.5 text-gray-500" />
                    <span v-else class="inline-block w-3.5" />
                  </button>
                  <FolderIcon class="h-4 w-4 text-gray-400" />
                  <span class="flex-1 text-left truncate">{{ group.name }}</span>
                  <span class="text-xs text-gray-400">{{ group.noteCount }}</span>
                </div>
                <div
                  v-if="isGroupExpanded(group) && group.children.length > 0"
                  class="ml-4 pl-2 border-l border-gray-200"
                >
                  <folder-tree
                    :folders="group.children"
                    :selected-path="selectedFolderPath"
                    @select="selectFolder(group, $event)"
                  />
                </div>
              </div>
            </li>
          </ul>
        </div>
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
          @select="emit('selectNote', $event)"
          @retry="emit('retry', $event)"
        />
      </aside>

      <!-- Note detail -->
      <main class="flex-1 bg-white overflow-hidden">
        <note-detail
          v-if="selectedNotePath && note"
          :note="note"
          :start-editing="startEditing"
          @save="emit('saveNote', $event)"
          @add-tag="emit('addTag', $event)"
          @remove-tag="emit('removeTag', $event)"
          @editing-started="emit('editingStarted')"
          @retry="emit('retry', selectedNotePath!)"
        />
        <div v-else class="h-full flex items-center justify-center text-gray-500">
          {{ t('notes.selectNote') }}
        </div>
      </main>
    </div>
  </div>
</template>
