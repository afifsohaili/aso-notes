<script setup lang="ts">
import { ref } from 'vue'
import ChevronDownIcon from '~icons/heroicons/chevron-down'
import ChevronRightIcon from '~icons/heroicons/chevron-right'
import DocumentIcon from '~icons/heroicons/document'
import FolderIcon from '~icons/heroicons/folder'

export interface FolderNode {
  name: string
  path: string
  hasCover: boolean
  noteCount: number
  children: FolderNode[]
}

const props = defineProps<{
  folders: FolderNode[]
  selectedPath: string | null
}>()

const emit = defineEmits<{
  (e: 'select', path: string): void
}>()

const expanded = ref<Set<string>>(new Set())

function toggle(folder: FolderNode) {
  if (expanded.value.has(folder.path)) {
    expanded.value.delete(folder.path)
  }
  else {
    expanded.value.add(folder.path)
  }
}

function isExpanded(folder: FolderNode): boolean {
  return expanded.value.has(folder.path)
}

function isSelected(folder: FolderNode): boolean {
  return props.selectedPath === folder.path
}
</script>

<template>
  <div class="p-2">
    <ul class="space-y-1">
      <li
        v-for="folder in folders"
        :key="folder.path"
      >
        <div class="group">
          <div
            class="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-gray-100 cursor-pointer"
            :class="isSelected(folder) ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700'"
            @click="emit('select', folder.path)"
          >
            <button
              type="button"
              class="p-0.5 rounded hover:bg-gray-200"
              @click.stop="toggle(folder)"
            >
              <ChevronDownIcon v-if="isExpanded(folder)" class="h-3.5 w-3.5 text-gray-500" />
              <ChevronRightIcon v-else-if="folder.children.length > 0" class="h-3.5 w-3.5 text-gray-500" />
              <span v-else class="inline-block w-3.5" />
            </button>
            <FolderIcon class="h-4 w-4 text-gray-400" />
            <span class="flex-1 text-left truncate">{{ folder.name }}</span>
            <span
              v-if="folder.hasCover"
              class="text-xs text-indigo-500"
              title="Folder cover"
            >
              <DocumentIcon class="h-3 w-3" />
            </span>
            <span class="text-xs text-gray-400">{{ folder.noteCount }}</span>
          </div>
          <div
            v-if="isExpanded(folder) && folder.children.length > 0"
            class="ml-4 pl-2 border-l border-gray-200"
          >
            <folder-tree
              :folders="folder.children"
              :selected-path="selectedPath"
              @select="emit('select', $event)"
            />
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
