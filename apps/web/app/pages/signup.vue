<script setup>
const session = useSession()
const router = useRouter()

// Redirect to chat home if already logged in
watchEffect(() => {
  if (session.value)
    router.push('/chat')
})
</script>

<template>
  <signup-form />
</template>
