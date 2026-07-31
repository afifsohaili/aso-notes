<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import EyeIcon from '~icons/heroicons/eye'
import EyeSlashIcon from '~icons/heroicons/eye-slash'
import AuthCard from './auth-card.vue'
import AuthToast from './auth-toast.vue'

const loading = ref(false)
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const toast = ref<{ message: string, type: 'error' | 'success' } | null>(null)

const { t } = useI18n()

function showToast(message: string, type: 'error' | 'success') {
  toast.value = { message, type }
}

function clearToast() {
  toast.value = null
}

async function handleLogin() {
  try {
    clearToast()
    loading.value = true
    const result = await useAuthClient().signIn.email({
      email: email.value,
      password: password.value,
    })
    if (result.error) {
      showToast(result.error?.message || t('login-form.submit.error'), 'error')
      return
    }

    showToast(t('login-form.submit.success'), 'success')
    navigateTo('/chat')
  }
  catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : t('login-form.submit.error')
    showToast(errorMessage, 'error')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <AuthCard :title="t('login-form.title')">
    <form class="space-y-5" @submit.prevent="handleLogin">
      <div>
        <label for="email" class="block text-sm font-medium text-gray-700">
          {{ t('login-form.email.label') }}
        </label>
        <input
          id="email"
          v-model="email"
          class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
          type="email"
          :placeholder="t('login-form.email.placeholder')"
          required
          :disabled="loading"
        >
      </div>
      <div>
        <label for="password" class="block text-sm font-medium text-gray-700">
          {{ t('login-form.password.label') }}
        </label>
        <div class="relative mt-1">
          <input
            id="password"
            v-model="password"
            class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-sm text-gray-900 placeholder:text-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
            :type="showPassword ? 'text' : 'password'"
            :placeholder="t('login-form.password.placeholder')"
            required
            :disabled="loading"
          >
          <button
            type="button"
            class="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none"
            :aria-label="showPassword ? t('login-form.password.hide') : t('login-form.password.show')"
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          >
            <EyeSlashIcon v-if="showPassword" class="h-4 w-4" />
            <EyeIcon v-else class="h-4 w-4" />
          </button>
        </div>
      </div>
      <button
        type="submit"
        class="flex w-full items-center justify-center rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
        :disabled="loading"
      >
        <span v-if="loading" class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        {{ loading ? t('login-form.submit.loading') : t('login-form.submit.text') }}
      </button>
      <p class="text-center text-sm text-gray-600">
        {{ t('login-form.noAccount') }}
        <NuxtLink to="/signup" class="font-medium text-purple-600 hover:text-purple-500">
          {{ t('login-form.signupLink') }}
        </NuxtLink>
      </p>
    </form>
  </AuthCard>
  <AuthToast :toast="toast" @close="clearToast" />
</template>
