<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BeakerIcon from '~icons/heroicons/beaker'
import LockClosedIcon from '~icons/heroicons/lock-closed'

const { t } = useI18n()
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-gray-50 p-5 opacity-75">
    <div class="flex items-center gap-2">
      <BeakerIcon class="h-5 w-5 text-gray-500" />
      <h3 class="text-base font-semibold text-gray-900">
        {{ t('settings.wizard.steps.verify.title') }}
      </h3>
      <span class="ml-auto inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
        <LockClosedIcon class="h-3 w-3" />
        {{ t('settings.wizard.steps.verify.comingSoon') }}
      </span>
    </div>

    <p class="mt-2 text-sm text-gray-600">
      {{ t('settings.wizard.steps.verify.help') }}
    </p>

    <div class="mt-4 rounded-md border border-gray-200 bg-white p-4">
      <div class="flex items-center gap-3">
        <div class="h-2 w-2 rounded-full bg-gray-300" />>
        <span class="text-sm text-gray-500">{{ t('settings.wizard.steps.verify.placeholder') }}</span>
      </div>
    </div>
  </div>
</template>
