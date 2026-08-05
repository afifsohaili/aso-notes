<script setup lang="ts">
import type { SyncedFolder } from '~/components/settings/synced-folder-manager.vue'
import { useI18n } from 'vue-i18n'
import SyncedFolderManager from '~/components/settings/synced-folder-manager.vue'

interface SyncedFolderApiItem {
  id: string
  path: string
  basename: string
  noteCount: number
  alias: string | null
}

definePageMeta({
  layout: 'settings',
})

const { t } = useI18n()

const { data: folders, pending: foldersPending, refresh: refreshFolders } = await useFetch<SyncedFolderApiItem[]>('/api/synced-folders')

const folderAddError = ref('')
const folderAdding = ref(false)
const folderDeleteErrorId = ref('')
const folderDeleteError = ref('')
const folderAliasErrorId = ref('')
const folderAliasError = ref('')

async function addFolder(path: string) {
  folderAddError.value = ''
  folderDeleteErrorId.value = ''
  folderDeleteError.value = ''
  folderAdding.value = true
  try {
    await $fetch('/api/synced-folders', {
      method: 'POST',
      body: { path },
    })
    await refreshFolders()
  }
  catch (err) {
    if (err instanceof Error && 'statusCode' in err) {
      const status = (err as any).statusCode
      if (status === 409)
        folderAddError.value = t('settings.folders.errors.duplicateOrNested')
      else if (status === 400)
        folderAddError.value = t('settings.folders.errors.invalidPath')
      else
        folderAddError.value = t('settings.folders.errors.unknown')
    }
    else {
      folderAddError.value = t('settings.folders.errors.unknown')
    }
  }
  finally {
    folderAdding.value = false
  }
}

async function deleteFolder(id: string) {
  folderAddError.value = ''
  folderDeleteErrorId.value = ''
  folderDeleteError.value = ''
  try {
    await $fetch(`/api/synced-folders/${id}`, { method: 'DELETE' })
    await refreshFolders()
  }
  catch (err) {
    folderDeleteErrorId.value = id
    if (err instanceof Error && 'statusCode' in err && (err as any).statusCode === 404)
      folderDeleteError.value = t('settings.folders.errors.unknown')
    else
      folderDeleteError.value = t('settings.folders.errors.unknown')
  }
}

async function saveFolderAlias(id: string, alias: string | null) {
  folderAliasErrorId.value = ''
  folderAliasError.value = ''
  try {
    await $fetch(`/api/synced-folders/${id}`, {
      method: 'PATCH',
      body: { alias },
    })
    await refreshFolders()
  }
  catch (err) {
    folderAliasErrorId.value = id
    if (err instanceof Error && 'statusCode' in err && (err as any).statusCode === 400)
      folderAliasError.value = t('settings.folders.errors.aliasTooLong')
    else
      folderAliasError.value = t('settings.folders.errors.unknown')
  }
}

function normalisedFolders(): SyncedFolder[] {
  return Array.isArray(folders.value)
    ? folders.value.map(f => ({
        id: f.id,
        path: f.path,
        basename: f.basename,
        noteCount: f.noteCount,
        alias: f.alias ?? null,
      }))
    : []
}

const folderList = computed(() => normalisedFolders())
const addingOrLoading = computed(() => folderAdding.value || foldersPending.value)
</script>

<template>
  <section>
    <h2 class="text-lg font-semibold text-gray-900">
      {{ t('settings.folders.title') }}
    </h2>

    <div class="mt-4">
      <SyncedFolderManager
        :folders="folderList"
        :adding="addingOrLoading"
        :add-error="folderAddError"
        :delete-error-id="folderDeleteErrorId"
        :delete-error="folderDeleteError"
        :alias-error-id="folderAliasErrorId"
        :alias-error="folderAliasError"
        @add="addFolder"
        @delete="deleteFolder"
        @save-alias="saveFolderAlias"
      />
    </div>
  </section>
</template>
