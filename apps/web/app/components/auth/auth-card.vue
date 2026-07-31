<script setup lang="ts">
import Logo from '~/components/logo.vue'

const props = defineProps<{
  title?: string
}>()
</script>

<template>
  <div class="min-h-screen bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
    <div class="mx-auto w-full max-w-md">
      <div class="mb-8 flex justify-center">
        <Logo class="text-2xl" />
      </div>
      <div class="rounded-xl border border-gray-200 bg-white px-6 py-8 shadow-sm sm:px-10">
        <h1 v-if="props.title" class="mb-6 text-center text-2xl font-bold tracking-tight text-gray-900">
          {{ props.title }}
        </h1>
        <slot />
      </div>
    </div>
  </div>
</template>
