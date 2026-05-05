<script lang="ts" setup>
const loading = ref(false)
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const alert = ref({
  message: '',
  type: '' as 'error' | 'success' | '',
})
const config = useRuntimeConfig()
useHead({
  script: [
    {
      src: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
      async: true,
      defer: true,
    },
  ],
})

async function handleSignup() {
  try {
    // Basic validation
    if (password.value !== confirmPassword.value) {
      alert.value = {
        message: 'Passwords do not match',
        type: 'error',
      }
      return
    }

    const turnstileToken = (window as any)?.turnstile?.getResponse()
    if (!turnstileToken) {
      alert.value = {
        message: 'Please complete the Turnstile challenge',
        type: 'error',
      }
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
      alert.value = {
        message: 'Failed to validate security check. Please try again.',
        type: 'error',
      }
      return
    }

    // Using the signUp function directly
    const result = await useAuthClient().signUp.email({
      email: email.value,
      password: password.value,
      name: email.value.split('@')[0],
    })

    if (result.error) {
      alert.value = {
        message: result.error?.message || 'Sign up failed',
        type: 'error',
      }
      return
    }

    alert.value = { message: 'Sign up successful! You can now log in.', type: 'success' }

    // navigate home
    navigateTo('/')
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
  <form class="grid h-screen place-items-center" @submit.prevent="handleSignup">
    <div class="p-8 center flex flex-col items-center rounded-lg shadow-lg">
      <logo class="text-4xl" />
      <h2 class="text-2xl font-bold mt-4">
        Sign Up
      </h2>
      <div class="mt-8 mb-4">
        <label for="email" class="block mb-1">Email</label>
        <input
          id="email" v-model="email" class="w-full border p-2 rounded-lg shadow-inner"
          type="email" placeholder="Enter your email"
          required
        >
      </div>
      <div class="mb-4">
        <label for="password" class="block mb-1">Password</label>
        <input
          id="password" v-model="password" class="w-full border p-2 rounded-lg shadow-inner"
          type="password" placeholder="Create a password"
          required
        >
      </div>
      <div class="mb-8">
        <label for="confirmPassword" class="block mb-1">Confirm Password</label>
        <input
          id="confirmPassword" v-model="confirmPassword" class="w-full border p-2 rounded-lg shadow-inner"
          type="password" placeholder="Confirm your password"
          required
        >
      </div>
      <div class="mb-8 flex justify-center">
        <div
          class="cf-turnstile" :data-sitekey="config.public.turnstileSiteKey" data-callback="e => console.log('cloudflare callback', e)"
        />
      </div>
      <input
        type="submit"
        class="bg-purple-900 text-white rounded-lg p-4 w-full"
        :value="loading ? 'Creating account...' : 'Sign Up'"
        :disabled="loading"
      >
      <div class="mt-4 text-center">
        <p>
          Already have an account? <NuxtLink to="/login" class="text-purple-700">
            Log in
          </NuxtLink>
        </p>
      </div>
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
