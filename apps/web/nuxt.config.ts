import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import Icons from 'unplugin-icons/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  modules: [
    'radix-vue/nuxt',
    '@vueuse/nuxt',
    ['unplugin-icons/nuxt', {}],
    '@nuxt/content',
    '@nuxt/image',
    '@nuxtjs/seo',
    '@nuxt/test-utils/module',
  ],
  components: [
    { path: '~/components', pathPrefix: false },
  ],
  site: {
    url: process.env.NUXT_PUBLIC_SITE_URL,
  },
  vite: {
    plugins: [
      Icons(),
      tailwindcss(),
    ],
  },
  runtimeConfig: {
    public: {
      turnstileSiteKey: '',
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL || '',
    },
    betterAuthSecret: '',
    posthogApiKey: '',
    databaseUrl: '',
    turnstileSecretKey: '',
    emailProvider: '',
    senderEmail: '',
    senderName: '',
  },
  postcss: {
    plugins: {
      autoprefixer: {},
    },
  },
  // sitemap: {
  //   exclude: [
  //     '/admin/**',
  //     '/admin',
  //     '/login',
  //     '/signup',
  //     '/forgot-password',
  //   ],
  // },
  nitro: {
    experimental: {
      websocket: true,
    },
  },
  compatibilityDate: '2025-05-14',
})
