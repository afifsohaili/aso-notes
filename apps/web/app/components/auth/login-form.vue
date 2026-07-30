<script lang="ts" setup>
import { useI18n } from 'vue-i18n'

const loading = ref(false)
const email = ref('')
const password = ref('')
const alert = ref({
  message: '',
  type: '' as 'error' | 'success' | '',
})

const { t } = useI18n()
async function handleLogin() {
  try {
    loading.value = true
    const result = await useAuthClient().signIn.email({
      email: email.value,
      password: password.value,
    })
    if (result.error) {
      alert.value = {
        message: result.error?.message || t('login-form.submit.error'),
        type: 'error',
      }
      return
    }

    alert.value = { message: t('login-form.submit.success'), type: 'success' }

    navigateTo('/chat')
  }
  catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An error occurred'
    alert.value = { message: errorMessage, type: 'error' }
  }
  finally {
    loading.value = false
  }
}

const floatingDialogRef = ref(null)

const floatingDialogClasses = {
  error: 'bg-red-500 block translate-y-0',
  success: 'bg-green-500 block translate-y-0',
}

const floatingDialogClass = computed(() => {
  return alert.value.type ? floatingDialogClasses[alert.value.type] || 'translate-y-full' : 'translate-y-full'
})
</script>

<template>
  <form class="grid h-screen place-items-center" @submit.prevent="handleLogin">
    <div class="p-8 center flex flex-col items-center rounded-lg shadow-lg">
      <logo class="text-4xl" />
      <div class="mt-16 mb-8">
        <label for="email" class="block mb-1">{{ t('login-form.email.label') }}</label>
        <input
          id="email" v-model="email" class="w-full border p-2 rounded-lg shadow-inner"
          type="email" :placeholder="t('login-form.email.placeholder')"
        >
      </div>
      <div class="mb-8">
        <label for="password" class="block mb-1">{{ t('login-form.password.label', 'Password') }}</label>
        <input
          id="password" v-model="password" class="w-full border p-2 rounded-lg shadow-inner"
          type="password" :placeholder="t('login-form.password.placeholder', 'Enter your password')"
        >
      </div>
      <input
        type="submit"
        class="bg-purple-900 text-white rounded-lg p-4"
        :value="loading ? t('login-form.submit.loading') : t('login-form.submit.text')"
        :disabled="loading"
      >
      or sign up <nuxt-link to="/signup">
        here
      </nuxt-link>
    </div>
  </form>
  <Teleport to="body">
    <floating-dialog
      ref="floatingDialogRef" class="rounded-t-lg p-4 transition-transform fixed bottom-0"
      :class="floatingDialogClass"
      @close="alert.message = ''"
    >
      <p>
        {{ alert.message }}
      </p>
    </floating-dialog>
  </Teleport>
</template>
