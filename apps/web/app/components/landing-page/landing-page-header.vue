<script lang="ts" setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { session } = await useSession()
</script>

<template>
  <nav class="container flex flex-wrap items-center justify-between p-8 mx-auto">
    <a href="/">
      <logo class="text-4xl" />
    </a>
    <div class="hidden md:flex items-center gap-4">
      <template v-if="session">
        <nuxt-link to="/notes" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
          {{ t('notes.title') }}
        </nuxt-link>
        <nuxt-link to="/graph" class="text-gray-700 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium">
          {{ t('graph.title') }}
        </nuxt-link>
      </template>
      <a class="px-6 py-2 text-white bg-indigo-600 rounded-md md:ml-5" href="/">{{ t('landingpage.general.cta') }}</a>
      <div class="flex items-center">
        <language-switcher />
      </div>
    </div>
  </nav>
</template>
