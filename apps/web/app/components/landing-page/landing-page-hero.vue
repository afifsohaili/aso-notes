<script lang="ts" setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="container p-8 md:p-0 mx-auto md:flex justify-between items-center gap-8">
    <div class="max-w-2xl mb-8">
      <h1
        class="text-4xl font-bold leading-snug tracking-tight text-gray-800"
      >
        {{ t('landingpage.hero.title') }}
      </h1>
      <p class="py-5 text-xl leading-normal text-gray-500 lg:text-xl xl:text-2xl ">
        {{ t('landingpage.hero.subtitle') }}
      </p>
      <div class="flex flex-col items-start space-y-3 sm:space-x-4 sm:space-y-0 sm:items-center sm:flex-row">
        <NuxtLink
          to="/signup" class="px-8 py-4 text-lg font-medium text-center text-white bg-indigo-600 rounded-md "
        >
          {{ t('landingpage.hero.cta') }}
        </NuxtLink>
      </div>
      <ul class="pt-4">
        <li class="flex items-center">
          <i-mdi-check class="mr-2" /> {{ t('landingpage.hero.result1') }}
        </li>
        <li class="flex items-center">
          <i-mdi-check class="mr-2" /> {{ t('landingpage.hero.result2') }}
        </li>
        <li class="flex items-center">
          <i-mdi-check class="mr-2" /> {{ t('landingpage.hero.result3') }}
        </li>
      </ul>
    </div>
    <div class="">
      <img
        alt="Hero Illustration" loading="eager" width="616" height="617" decoding="async" data-nimg="1"
        class="object-cover drop-shadow-lg" style="color: transparent;"
        src="https://picsum.photos/600/500"
      >
    </div>
  </div>
</template>
