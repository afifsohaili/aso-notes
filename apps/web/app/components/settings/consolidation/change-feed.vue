<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ArrowPathRoundedSquareIcon from '~icons/heroicons/arrow-path-rounded-square'
import FolderArrowIcon from '~icons/heroicons/folder-arrow-down'
import PencilIcon from '~icons/heroicons/pencil'
import ScissorsIcon from '~icons/heroicons/scissors'
import SparklesIcon from '~icons/heroicons/sparkles'

interface Change {
  id: string
  action: 'merge-concept' | 'merge-topic' | 'prune' | 'rewrite' | 'dissolve' | 'refile'
  text: string
  reason: string
}

defineProps<{
  changes: Change[]
}>()

const { t } = useI18n()

function actionIcon(action: Change['action']) {
  switch (action) {
    case 'merge-concept':
    case 'merge-topic':
      return ArrowPathRoundedSquareIcon
    case 'prune':
      return ScissorsIcon
    case 'rewrite':
      return PencilIcon
    case 'dissolve':
      return SparklesIcon
    case 'refile':
      return FolderArrowIcon
    default:
      return ArrowPathRoundedSquareIcon
  }
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-5" data-testid="change-feed">
    <h3 class="text-sm font-semibold text-gray-900">
      {{ t('settings.consolidation.changes.title') }}
    </h3>

    <ul v-if="changes.length > 0" class="mt-3 space-y-3">
      <li v-for="change in changes" :key="change.id" class="text-sm text-gray-700">
        <div class="flex items-start gap-2">
          <component :is="actionIcon(change.action)" class="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
          <div>
            <p class="font-medium text-gray-900">
              {{ change.text }}
            </p>
            <p class="mt-0.5 text-xs text-gray-500">
              {{ change.reason }}
            </p>
          </div>
        </div>
      </li>
    </ul>

    <p v-else class="mt-3 text-sm text-gray-400">
      {{ t('settings.consolidation.changes.empty') }}
    </p>
  </div>
</template>
