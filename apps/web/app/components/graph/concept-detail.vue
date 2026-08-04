<script setup lang="ts">
import type { ConceptDetail } from '~/server/lib/graph/ui'
import { useI18n } from 'vue-i18n'
import DocumentIcon from '~icons/heroicons/document-text'
import LightBulbIcon from '~icons/heroicons/light-bulb'

const props = defineProps<{
  detail: ConceptDetail | null
}>()

const emit = defineEmits<{
  (e: 'openNote', path: string): void
}>()

const { t } = useI18n()

const concept = computed(() => props.detail?.concept ?? null)
const neighbors = computed(() => props.detail?.neighbors ?? [])
const mentionedIn = computed(() => props.detail?.mentionedIn ?? [])
const topics = computed(() => props.detail?.concept.topics ?? [])
</script>

<template>
  <div class="h-full overflow-y-auto p-4">
    <template v-if="concept">
      <div class="flex items-start gap-3 mb-4">
        <LightBulbIcon class="h-5 w-5 text-indigo-600 mt-0.5" />
        <div>
          <h2 class="text-lg font-semibold text-gray-900">
            {{ concept.name }}
          </h2>
          <p v-if="concept.description" class="text-sm text-gray-600 mt-1">
            {{ concept.description }}
          </p>
        </div>
      </div>

      <div v-if="topics.length > 0" class="mb-4">
        <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          {{ t('graph.topics') }}
        </h3>
        <ul class="flex flex-wrap gap-2">
          <li
            v-for="topic in topics"
            :key="topic"
            class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-violet-100 text-violet-800"
          >
            {{ topic }}
          </li>
        </ul>
      </div>

      <div v-if="neighbors.length > 0" class="mb-6">
        <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          {{ t('graph.neighbors') }}
        </h3>
        <ul class="space-y-2">
          <li
            v-for="neighbor in neighbors"
            :key="neighbor.id"
            class="text-sm p-2 rounded-md bg-gray-50"
          >
            <span class="font-medium text-gray-900">{{ neighbor.name }}</span>
            <span class="text-xs text-gray-500 ml-2">({{ neighbor.type }})</span>
          </li>
        </ul>
      </div>

      <div v-if="mentionedIn.length > 0">
        <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          {{ t('graph.mentionedIn') }}
        </h3>
        <ul class="space-y-2">
          <li
            v-for="note in mentionedIn"
            :key="note.path"
            class="text-sm"
          >
            <button
              class="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-900"
              @click="emit('openNote', note.path)"
            >
              <DocumentIcon class="h-4 w-4" />
              <span>{{ note.title || note.path }}</span>
              <span v-if="note.rootName" class="text-gray-400"> &lt;{{ note.rootName }}&gt;</span>
            </button>
          </li>
        </ul>
      </div>
    </template>

    <div v-else class="h-full flex items-center justify-center text-gray-500 text-sm text-center px-4">
      {{ t('graph.noSelection') }}
    </div>
  </div>
</template>
