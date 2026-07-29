<script lang="ts" setup>
import { useI18n } from 'vue-i18n'
import CogIcon from '~icons/heroicons/cog'
import QueueListIcon from '~icons/heroicons/queue-list'

const { t } = useI18n()
const route = useRoute()
const { session } = await useSession()

const links = [
  { to: '/chat', label: () => t('chat.title') },
  { to: '/notes', label: () => t('notes.title') },
  { to: '/notes/queue', label: () => t('queue.title'), icon: QueueListIcon },
  { to: '/graph', label: () => t('graph.title') },
  { to: '/settings', label: () => t('settings.title'), icon: CogIcon },
]

function isActive(to: string) {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <header class="sticky top-0 z-40 h-14 bg-white border-b border-gray-200">
    <div class="container flex items-center justify-between px-6 py-3 mx-auto">
      <NuxtLink to="/" class="text-lg">
        <logo />
      </NuxtLink>

      <nav v-if="session" class="flex items-center gap-1">
        <NuxtLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="px-3 py-2 rounded-md text-sm font-medium inline-flex items-center gap-1.5"
          :class="isActive(link.to)
            ? 'text-indigo-600 underline underline-offset-8 decoration-2'
            : 'text-gray-600 hover:text-gray-900'"
        >
          <component
            :is="link.icon"
            v-if="link.icon"
            class="h-4 w-4"
            aria-hidden="true"
          />
          {{ link.label() }}
        </NuxtLink>
      </nav>
    </div>
  </header>
</template>
