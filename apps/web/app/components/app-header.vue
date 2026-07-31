<script lang="ts" setup>
import { useI18n } from 'vue-i18n'
import ChatBubbleIcon from '~icons/heroicons/chat-bubble-left-right'
import CogIcon from '~icons/heroicons/cog'
import DocumentTextIcon from '~icons/heroicons/document-text'
import QueueListIcon from '~icons/heroicons/queue-list'
import ShareIcon from '~icons/heroicons/share'

const { t } = useI18n()
const route = useRoute()
const { session } = await useSession()

const links: { to: string, label: () => string, exact?: boolean, icon: unknown }[] = [
  { to: '/chat', label: () => t('chat.title'), icon: ChatBubbleIcon },
  { to: '/notes', label: () => t('notes.title'), exact: true, icon: DocumentTextIcon },
  { to: '/notes/queue', label: () => t('queue.title'), icon: QueueListIcon },
  { to: '/graph', label: () => t('graph.title'), icon: ShareIcon },
  { to: '/settings', label: () => t('settings.title'), icon: CogIcon },
]

function isActive(to: string, exact = false) {
  return route.path === to || (!exact && route.path.startsWith(`${to}/`))
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
          class="px-3 py-2 rounded-md text-sm font-medium inline-flex items-center gap-1.5 transition-colors"
          :class="isActive(link.to, link.exact)
            ? 'text-indigo-600 underline underline-offset-8 decoration-2'
            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'"
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
