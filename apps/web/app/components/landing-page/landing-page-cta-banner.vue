<script lang="ts" setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="container mx-auto my-24 flex flex-col items-center">
    <h3 class="font-bold text-3xl mb-8">
      {{ t('landingpage.cta.title') }}
    </h3>
    <nuxt-link
      to="/signup" class="block px-8 py-4 text-lg font-medium text-center text-white bg-indigo-600 rounded-md "
    >
      {{ t('landingpage.general.cta') }}
    </nuxt-link>
  </div>
</template>
