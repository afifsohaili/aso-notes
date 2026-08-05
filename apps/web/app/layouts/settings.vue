<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import CogIcon from '~icons/heroicons/cog-6-tooth'

const { t } = useI18n()
const route = useRoute()

interface NavItem {
  id: string
  label: string
  path: string
  indent?: boolean
}

const items: NavItem[] = [
  { id: 'folders', label: t('settings.nav.folders'), path: '/settings/folders' },
  { id: 'llm-providers', label: t('settings.nav.llmProviders'), path: '/settings/llm-providers' },
  { id: 'extraction', label: t('settings.nav.extraction'), path: '/settings/extraction' },
  { id: 'consolidation', label: t('settings.nav.consolidation'), path: '/settings/extraction/consolidation', indent: true },
]

const activeItem = computed(() => {
  const sorted = [...items].sort((a, b) => b.path.length - a.path.length)
  return sorted.find(item => route.path === item.path || route.path.startsWith(`${item.path}/`)) ?? items[0]
})
</script>

<template>
  <div class="container mx-auto px-4 py-6 md:px-6 md:py-10">
    <div class="mb-6 flex items-center gap-2 md:mb-8">
      <CogIcon class="h-6 w-6 text-gray-700" />
      <h1 class="text-xl font-bold text-gray-900 md:text-2xl">
        {{ t('settings.title') }}
      </h1>
    </div>

    <!-- Mobile horizontal nav -->
    <nav class="mb-6 md:hidden" aria-label="Settings sections">
      <div class="flex gap-2 overflow-x-auto pb-2">
        <NuxtLink
          v-for="item in items"
          :key="item.id"
          :to="item.path"
          class="whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
          :class="activeItem.id === item.id
            ? 'bg-indigo-100 text-indigo-700'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
        >
          {{ item.label }}
        </NuxtLink>
      </div>
    </nav>

    <div class="flex gap-6 md:gap-10">
      <!-- Desktop sidebar -->
      <nav class="hidden w-48 flex-shrink-0 md:block" aria-label="Settings sections">
        <div class="space-y-1">
          <NuxtLink
            v-for="item in items"
            :key="item.id"
            :to="item.path"
            class="block rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="[
              activeItem.id === item.id
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-gray-600 hover:bg-gray-100',
              item.indent ? 'pl-6' : '',
            ]"
          >
            {{ item.label }}
          </NuxtLink>
        </div>
      </nav>

      <div class="min-w-0 flex-1">
        <slot />
      </div>
    </div>
  </div>
</template>
