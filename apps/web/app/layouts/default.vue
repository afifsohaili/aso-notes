<script setup>
import { appInfo } from '~/composables/app'

useHead({
  title: appInfo.title,
  meta: [
    { charset: 'utf-8' },
    { name: 'description', content: appInfo.description },
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'alternate icon', type: 'image/png', href: '/favicon.png' },
  ],
})
</script>

<template>
  <app-header />
  <main>
    <slot />
  </main>
  <dev-only><breakpoints-display /></dev-only>
</template>
