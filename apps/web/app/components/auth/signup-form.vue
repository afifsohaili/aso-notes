<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import EyeIcon from '~icons/heroicons/eye'
import EyeSlashIcon from '~icons/heroicons/eye-slash'
import AuthCard from './auth-card.vue'
import AuthToast from './auth-toast.vue'

const loading = ref(false)
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const toast = ref<{ message: string, type: 'error' | 'success' } | null>(null)
const verifyEmailState = ref(false)

const { t } = useI18n()
const config = useRuntimeConfig()

// Turnstile is not shown or required in local development
const isDev = process.env.NODE_ENV === 'development'
if (!isDev) {
  useHead({
    script: [
      {
        src: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
        async: true,
        defer: true,
      },
    ],
  })
}

function showToast(message: string, type: 'error' | 'success') {
  toast.value = { message, type }
}

function clearToast() {
  toast.value = null
}

async function handleSignup() {
  try {
    clearToast()
    verifyEmailState.value = false

    // Basic validation
    if (password.value !== confirmPassword.value) {
      showToast(t('signup-form.errors.passwordMismatch'), 'error')
      return
    }

    if (!isDev) {
      const turnstileToken = (window as any)?.turnstile?.getResponse()
      if (!turnstileToken) {
        showToast(t('signup-form.errors.turnstileRequired'), 'error')
        return
      }

      loading.value = true

      // Validate Turnstile token first
      try {
        await $fetch('/api/auth/captcha', {
          method: 'POST',
          body: { token: turnstileToken },
        })
      }
      catch {
        showToast(t('signup-form.errors.captchaFailed'), 'error')
        return
      }
    }
    else {
      loading.value = true
    }

    const result = await useAuthClient().signUp.email({
      email: email.value,
      password: password.value,
      name: email.value.split('@')[0],
    })

    if (result.error) {
      showToast(result.error?.message || t('signup-form.submit.error'), 'error')
      return
    }

    // Dev/verified path: better-auth created a session immediately
    if (result.data?.token || (result.data as any)?.session?.token) {
      showToast(t('signup-form.submit.success'), 'success')
      navigateTo('/chat')
      return
    }

    // Email-verification path: no session yet
    verifyEmailState.value = true
    showToast(t('signup-form.submit.verifyEmail'), 'success')
  }
  catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : t('signup-form.submit.error')
    showToast(errorMessage, 'error')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthCard :title="t('signup-form.title')">
    <form class="space-y-5" @submit.prevent="handleSignup">
      <div>
        <label for="email" class="block text-sm font-medium text-gray-700">
          {{ t('signup-form.email.label') }}
        </label>
        <input
          id="email"
          v-model="email"
          class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
          type="email"
          :placeholder="t('signup-form.email.placeholder')"
          required
          :disabled="loading"
        >
      </div>
      <div>
        <label for="password" class="block text-sm font-medium text-gray-700">
          {{ t('signup-form.password.label') }}
        </label>
        <div class="relative mt-1">
          <input
            id="password"
            v-model="password"
            class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
            :type="showPassword ? 'text' : 'password'"
            :placeholder="t('signup-form.password.placeholder')"
            required
            :disabled="loading"
          >
          <button
            type="button"
            class="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none"
            :aria-label="showPassword ? t('signup-form.password.hide') : t('signup-form.password.show')"
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          >
            <EyeSlashIcon v-if="showPassword" class="h-4 w-4" />
            <EyeIcon v-else class="h-4 w-4" />
          </button>
        </div>
      </div>
      <div>
        <label for="confirmPassword" class="block text-sm font-medium text-gray-700">
          {{ t('signup-form.confirmPassword.label') }}
        </label>
        <div class="relative mt-1">
          <input
            id="confirmPassword"
            v-model="confirmPassword"
            class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
            :type="showConfirmPassword ? 'text' : 'password'"
            :placeholder="t('signup-form.confirmPassword.placeholder')"
            required
            :disabled="loading"
          >
          <button
            type="button"
            class="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none"
            :aria-label="showConfirmPassword ? t('signup-form.password.hide') : t('signup-form.password.show')"
            :aria-pressed="showConfirmPassword"
            @click="showConfirmPassword = !showConfirmPassword"
          >
            <EyeSlashIcon v-if="showConfirmPassword" class="h-4 w-4" />
            <EyeIcon v-else class="h-4 w-4" />
          </button>
        </div>
      </div>
      <div v-if="!isDev" class="flex justify-center">
        <div
          class="cf-turnstile"
          :data-sitekey="config.public.turnstileSiteKey"
          data-callback="e => console.log('cloudflare callback', e)"
        />
      </div>
      <button
        type="submit"
        class="flex w-full items-center justify-center rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
        :disabled="loading"
      >
        <span v-if="loading" class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        {{ loading ? t('signup-form.submit.loading') : t('signup-form.submit.text') }}
      </button>
      <p class="text-center text-sm text-gray-600">
        {{ t('signup-form.hasAccount') }}
        <NuxtLink to="/login" class="font-medium text-purple-600 hover:text-purple-500">
          {{ t('signup-form.loginLink') }}
        </NuxtLink>
      </p>
    </form>
    <div
      v-if="verifyEmailState"
      class="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-center text-sm text-green-800"
      role="status"
    >
      {{ t('signup-form.verifyEmailState') }}
    </div>
  </AuthCard>
  <AuthToast :toast="toast" @close="clearToast" />
</template>
