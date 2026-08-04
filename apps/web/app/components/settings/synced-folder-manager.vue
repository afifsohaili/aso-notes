<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import FolderIcon from '~icons/heroicons/folder'
import PencilSquareIcon from '~icons/heroicons/pencil-square'
import TrashIcon from '~icons/heroicons/trash'
import XCircleIcon from '~icons/heroicons/x-circle'

export interface SyncedFolder {
  id: string
  path: string
  noteCount: number
  alias?: string | null
}

interface Props {
  folders: SyncedFolder[]
  adding?: boolean
  addError?: string
  deleteErrorId?: string
  deleteError?: string
  aliasErrorId?: string
  aliasError?: string
}

const props = withDefaults(defineProps<Props>(), {
  adding: false,
  addError: '',
  deleteErrorId: '',
  deleteError: '',
  aliasErrorId: '',
  aliasError: '',
})

const emit = defineEmits<{
  (e: 'add', path: string): void
  (e: 'delete', id: string): void
  (e: 'saveAlias', id: string, alias: string | null): void
}>()

const REMOVE_CONFIRM_TEXT = 'REMOVE'

const { t } = useI18n()

const newPath = ref('')
const confirmingFolderId = ref<string | null>(null)
const confirmText = ref('')
const editingAliasId = ref<string | null>(null)
const aliasDraft = ref('')

const isRemoveConfirmed = computed(() => confirmText.value.trim() === REMOVE_CONFIRM_TEXT)
const confirmingFolder = computed(() => props.folders.find(f => f.id === confirmingFolderId.value) ?? null)

function splitPath(path: string): { parent: string, basename: string } {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const idx = trimmed.lastIndexOf('/')
  if (idx === -1)
    return { parent: '', basename: trimmed }
  return { parent: `${trimmed.slice(0, idx + 1)}`, basename: trimmed.slice(idx + 1) }
}

function folderParent(folder: SyncedFolder): string {
  return splitPath(folder.path).parent
}

function folderLabel(folder: SyncedFolder): string {
  if (folder.alias)
    return folder.alias
  return splitPath(folder.path).basename
}

function submit() {
  const path = newPath.value.trim()
  if (!path || props.adding)
    return
  newPath.value = ''
  emit('add', path)
}

function openRemoveConfirm(id: string) {
  if (props.adding)
    return
  confirmingFolderId.value = id
  confirmText.value = ''
}

function cancelRemoveConfirm() {
  confirmingFolderId.value = null
  confirmText.value = ''
}

function confirmRemove() {
  const id = confirmingFolderId.value
  if (!id || !isRemoveConfirmed.value)
    return
  cancelRemoveConfirm()
  emit('delete', id)
}

function startAliasEdit(folder: SyncedFolder) {
  if (props.adding)
    return
  editingAliasId.value = folder.id
  aliasDraft.value = folder.alias ?? ''
}

function cancelAliasEdit() {
  editingAliasId.value = null
  aliasDraft.value = ''
}

function saveAlias(folder: SyncedFolder) {
  if (props.adding)
    return
  const trimmed = aliasDraft.value.trim()
  emit('saveAlias', folder.id, trimmed === '' ? null : trimmed)
  cancelAliasEdit()
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
          <FolderIcon class="h-5 w-5 flex-shrink-0 text-gray-400" />
          <div class="min-w-0">
            <p v-if="editingAliasId === folder.id" class="flex items-center gap-2">
              <input
                v-model="aliasDraft"
                type="text"
                class="block w-56 rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                :placeholder="t('settings.folders.aliasPlaceholder')"
                :disabled="adding"
                data-testid="alias-input"
                @keydown.enter="saveAlias(folder)"
                @keydown.esc="cancelAliasEdit"
              >
              <button
                type="button"
                class="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                :disabled="adding"
                data-testid="alias-save-button"
                @click="saveAlias(folder)"
              >
                {{ t('settings.folders.save') }}
              </button>
              <button
                type="button"
                class="inline-flex items-center rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100"
                :disabled="adding"
                data-testid="alias-cancel-button"
                @click="cancelAliasEdit"
              >
                {{ t('settings.folders.cancel') }}
              </button>
            </p>
            <p
              v-else
              class="truncate text-sm font-medium text-gray-900"
              :title="folder.path"
              data-testid="folder-label"
            >
              <span v-if="folderParent(folder)" class="font-normal text-gray-400" data-testid="folder-parent-path">{{ folderParent(folder) }}</span>
              <span data-testid="folder-name">{{ folderLabel(folder) }}</span>
            </p>
            <p class="text-xs text-gray-500">
              {{ t('settings.folders.noteCount', { count: folder.noteCount }) }}
            </p>
            <p
              v-if="aliasErrorId === folder.id"
              class="mt-1 text-xs text-red-600"
              role="alert"
              data-testid="folder-alias-error"
            >
              {{ aliasError }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            v-if="editingAliasId !== folder.id"
            type="button"
            class="inline-flex items-center rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            :title="t('settings.folders.editAlias')"
            :disabled="adding"
            data-testid="alias-edit-button"
            @click="startAliasEdit(folder)"
          >
            <PencilSquareIcon class="h-4 w-4" />
          </button>

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
            :disabled="adding"
            data-testid="folder-delete-button"
            @click="openRemoveConfirm(folder.id)"
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

    <!-- Remove confirmation dialog -->
    <div
      v-if="confirmingFolder"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      @click.self="cancelRemoveConfirm"
    >
      <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 class="text-lg font-semibold text-gray-900">
          {{ t('settings.folders.removeDialog.title') }}
        </h3>

        <p class="mt-2 text-sm text-gray-600">
          {{ t('settings.folders.removeDialog.help', { count: confirmingFolder.noteCount, path: confirmingFolder.path }) }}
        </p>

        <input
          v-model="confirmText"
          type="text"
          class="mt-4 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          :placeholder="t('settings.folders.removeDialog.placeholder')"
          data-testid="folder-remove-confirm-input"
        >

        <div class="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            class="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            data-testid="folder-remove-cancel-button"
            @click="cancelRemoveConfirm"
          >
            {{ t('settings.folders.removeDialog.cancel') }}
          </button>

          <button
            type="button"
            class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            :disabled="!isRemoveConfirmed"
            data-testid="folder-remove-confirm-button"
            @click="confirmRemove"
          >
            {{ t('settings.folders.removeDialog.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
